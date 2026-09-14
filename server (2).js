require('dotenv').config();
const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const Stripe = require('stripe');

const stripe = Stripe(process.env.STRIPE_SECRET_KEY);
const app = express();
const ORDERS_FILE = path.join(__dirname, 'orders.json');

// ---------------------------------------------------------------------------
// Catálogo de productos: vive AQUÍ, en el servidor, no en el navegador.
// Así el precio que se cobra siempre es el real, sin importar lo que
// alguien manipule en el frontend.
// ---------------------------------------------------------------------------
const PRODUCTS = {
  1:  { name: 'Cargador GaN 65W',            price: 3490 },
  2:  { name: 'Power bank 10,000mAh',        price: 2990 },
  3:  { name: 'Cable USB-C a USB-C 2m',      price: 1290 },
  4:  { name: 'Hub USB-C 7 en 1',            price: 4490 },
  5:  { name: 'Audífonos inalámbricos ANC',  price: 7990 },
  6:  { name: 'Parlante Bluetooth portátil', price: 3990 },
  7:  { name: 'Funda protectora antigolpes', price: 1990 },
  8:  { name: 'Mica de vidrio templado (x2)',price: 990  },
  9:  { name: 'Mouse inalámbrico ergonómico',price: 2490 },
  10: { name: 'Teclado mecánico compacto',   price: 5990 },
  11: { name: 'Auriculares gamer con mic',   price: 4990 },
  12: { name: 'Soporte ajustable de mesa',   price: 1790 }
  // precios en centavos de USD (3490 = $34.90)
};

// ---------------------------------------------------------------------------
// Envíos con Shippo. Ajusta esto con la dirección real de tu bodega y el
// tamaño de paquete que más uses — puedes tener varios "parcels" si vendes
// productos de tamaños muy distintos.
// ---------------------------------------------------------------------------
const STORE_ADDRESS = {
  name: 'Bodega CiberNova',
  street1: 'Calle 123 #45-67',
  city: 'Bogotá',
  state: 'DC',
  zip: '110111',
  country: 'CO',
  phone: '+573000000000',
  email: 'envios@tutienda.com'
};

const DEFAULT_PARCEL = {
  length: '20', width: '15', height: '8', distance_unit: 'cm',
  weight: '1', mass_unit: 'kg'
};

async function shippoRequest(endpoint, body) {
  const res = await fetch(`https://api.goshippo.com${endpoint}`, {
    method: 'POST',
    headers: {
      'Authorization': `ShippoToken ${process.env.SHIPPO_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(body)
  });
  const data = await res.json();
  if (!res.ok) throw new Error(data.detail || JSON.stringify(data));
  return data;
}

// Crea el envío, compra la tarifa más económica y devuelve la guía lista.
async function createShippingLabel(addressTo, parcel = DEFAULT_PARCEL) {
  const shipment = await shippoRequest('/shipments/', {
    address_from: STORE_ADDRESS,
    address_to: addressTo,
    parcels: [parcel],
    async: false
  });

  if (!shipment.rates || shipment.rates.length === 0) {
    throw new Error('Shippo no devolvió tarifas para esta dirección.');
  }

  const cheapest = shipment.rates.reduce((a, b) => (Number(a.amount) < Number(b.amount) ? a : b));

  const transaction = await shippoRequest('/transactions/', {
    rate: cheapest.object_id,
    label_file_type: 'PDF',
    async: false
  });

  if (transaction.status !== 'SUCCESS') {
    throw new Error(transaction.messages?.[0]?.text || 'No se pudo comprar la guía de envío.');
  }

  return {
    carrier: cheapest.provider,
    service: cheapest.servicelevel?.name,
    cost: cheapest.amount,
    tracking_number: transaction.tracking_number,
    tracking_url: transaction.tracking_url_provider,
    label_url: transaction.label_url
  };
}

function readOrders() {
  if (!fs.existsSync(ORDERS_FILE)) return [];
  return JSON.parse(fs.readFileSync(ORDERS_FILE, 'utf-8'));
}
function saveOrder(order) {
  const orders = readOrders();
  orders.push(order);
  fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
}

// El webhook necesita el cuerpo "crudo" de la petición para verificar la
// firma de Stripe, así que se declara ANTES de express.json().
app.post('/webhook', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = stripe.webhooks.constructEvent(
      req.body,
      req.headers['stripe-signature'],
      process.env.STRIPE_WEBHOOK_SECRET
    );
  } catch (err) {
    console.error('Firma de webhook inválida:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Respondemos a Stripe de inmediato: no lo hacemos esperar a que
  // termine de comprarse la guía de envío.
  res.json({ received: true });

  if (event.type !== 'checkout.session.completed') return;

  const session = event.data.object;
  const order = {
    id: session.id,
    email: session.customer_details?.email,
    total: session.amount_total,
    currency: session.currency,
    shipping: session.shipping_details || null,
    created: new Date().toISOString(),
    status: 'pagado',
    shippingLabel: null,
    shippingStatus: 'pendiente'
  };

  const dest = session.shipping_details?.address;
  if (dest) {
    try {
      const label = await createShippingLabel({
        name: session.shipping_details.name || order.email,
        street1: dest.line1,
        street2: dest.line2 || '',
        city: dest.city,
        state: dest.state || '',
        zip: dest.postal_code,
        country: dest.country,
        email: order.email
      });
      order.shippingLabel = label;
      order.shippingStatus = 'guía generada';
      console.log(`📦 Guía generada para ${order.id}: ${label.tracking_number}`);
    } catch (err) {
      // No queremos perder el pedido si Shippo falla — se guarda como
      // "pendiente" para generar la guía manualmente después.
      order.shippingStatus = 'error: ' + err.message;
      console.error(`⚠️  No se pudo generar guía para ${order.id}:`, err.message);
    }
  }

  saveOrder(order);
  console.log('✅ Nuevo pedido pagado:', order.id);
});

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// El frontend envía { items: [{id, qty}, ...] }; el servidor calcula el
// total real a partir de PRODUCTS y crea la sesión de pago con Stripe.
app.post('/create-checkout-session', async (req, res) => {
  try {
    const { items } = req.body;
    if (!Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'El carrito está vacío.' });
    }

    const line_items = items.map(({ id, qty }) => {
      const product = PRODUCTS[id];
      if (!product) throw new Error(`Producto ${id} no existe`);
      return {
        price_data: {
          currency: 'usd',
          product_data: { name: product.name },
          unit_amount: product.price
        },
        quantity: Math.max(1, Number(qty) || 1)
      };
    });

    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      payment_method_types: ['card'],
      line_items,
      shipping_address_collection: { allowed_countries: ['US','CA','MX','CO','AR','CL','PE','ES'] },
      success_url: `${process.env.CLIENT_URL}/exito.html?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${process.env.CLIENT_URL}/cancelado.html`
    });

    res.json({ url: session.url });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message });
  }
});

app.get('/api/orders', (req, res) => {
  // En producción, protege esta ruta con autenticación de administrador.
  res.json(readOrders());
});

// Prueba rápida de tarifas sin comprar nada — úsala primero para confirmar
// que tu SHIPPO_API_KEY funciona antes de conectar el flujo completo.
app.post('/api/shipping-rates', async (req, res) => {
  try {
    const shipment = await shippoRequest('/shipments/', {
      address_from: STORE_ADDRESS,
      address_to: req.body.address_to,
      parcels: [req.body.parcel || DEFAULT_PARCEL],
      async: false
    });
    res.json(shipment.rates || []);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Reintenta generar la guía de un pedido cuyo envío quedó "pendiente"
// (por ejemplo, si Shippo falló momentáneamente durante el webhook).
app.post('/api/orders/:id/create-label', async (req, res) => {
  const orders = readOrders();
  const order = orders.find(o => o.id === req.params.id);
  if (!order) return res.status(404).json({ error: 'Pedido no encontrado.' });
  if (!order.shipping?.address) return res.status(400).json({ error: 'Este pedido no tiene dirección de envío.' });

  try {
    const dest = order.shipping.address;
    const label = await createShippingLabel({
      name: order.shipping.name || order.email,
      street1: dest.line1, street2: dest.line2 || '',
      city: dest.city, state: dest.state || '',
      zip: dest.postal_code, country: dest.country,
      email: order.email
    });
    order.shippingLabel = label;
    order.shippingStatus = 'guía generada';
    fs.writeFileSync(ORDERS_FILE, JSON.stringify(orders, null, 2));
    res.json(label);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 4242;
app.listen(PORT, () => console.log(`Servidor CiberNova corriendo en http://localhost:${PORT}`));

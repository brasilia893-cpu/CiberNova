# CiberNova — Tienda con pagos y envíos reales

Ya no son piezas separadas: el frontend vive en `public/` y el mismo
servidor de Node lo sirve junto con los pagos (Stripe) y los envíos
(Shippo). Una sola app, una sola URL cuando la publiques.

```
cibernova-backend/
├── server.js          ← servidor: catálogo, pagos, envíos
├── public/
│   ├── index.html      ← tu tienda
│   ├── exito.html       ← página tras pago aprobado
│   └── cancelado.html    ← página si el cliente cancela el pago
├── orders.json         ← se crea solo, con cada pedido pagado
└── .env                 ← tus claves (no la subas a git)
```

## 1. Requisitos
- Node.js instalado (v18 o más reciente) → https://nodejs.org
- Cuenta gratis en https://dashboard.stripe.com
- Cuenta gratis en https://apps.goshippo.com

## 2. Instalación
```bash
npm install
cp .env.example .env
```
Llena `.env` con tus claves de Stripe y Shippo (ambas en modo prueba
mientras validas todo). Luego abre `server.js` y edita `STORE_ADDRESS`
con la dirección real desde donde despachas.

## 3. Ejecutar
```bash
npm start
```
Abre `http://localhost:4242` — ahí está tu tienda completa: catálogo,
carrito y un botón "Ir a pagar" que ya llama a Stripe de verdad.

## 4. Probar el webhook localmente
Stripe necesita avisarle a tu servidor cuando un pago se confirma (así
se dispara la compra automática de la guía de envío). Instala el Stripe
CLI (https://stripe.com/docs/stripe-cli) y corre:
```bash
stripe listen --forward-to localhost:4242/webhook
```
Copia el `whsec_...` que te da y pégalo en tu `.env`.

## 5. Hacer una compra de prueba de principio a fin
1. Agrega productos al carrito en `http://localhost:4242` y da clic en
   "Ir a pagar de forma segura".
2. En la pantalla de Stripe, usa la tarjeta de prueba
   `4242 4242 4242 4242`, cualquier fecha futura y cualquier CVC.
3. Revisa la terminal donde corre `stripe listen` — debe mostrar el
   evento `checkout.session.completed`.
4. Abre `orders.json`: debe aparecer el pedido con su `shippingLabel`
   (número de rastreo y enlace al PDF de la guía) si usaste una
   dirección de EE. UU. en el checkout de Stripe.

## 6. Ir a producción
- Sube este backend a un servidor real: Render, Railway o Fly.io tienen
  planes gratuitos/económicos y son sencillos para empezar.
- Cambia tus claves de Stripe y Shippo a modo "live".
- Actualiza `CLIENT_URL` con el dominio real de tu tienda.
- Reemplaza `orders.json` por una base de datos real (Postgres, MongoDB)
  cuando el volumen de pedidos crezca — un archivo funciona para empezar,
  no para escalar.

## 7. Envíos automáticos (Shippo) — ya integrado

Cada vez que un pago se confirma, el servidor ahora llama a **Shippo**
automáticamente: compra la guía más económica disponible y la guarda en
`orders.json` junto con el número de rastreo y el enlace al PDF de la
etiqueta.

### Configurarlo
1. Crea una cuenta gratis en https://apps.goshippo.com
2. Ve a Settings → API y copia tu clave de prueba (empieza con
   `shippo_test_...`). Pégala en tu `.env` como `SHIPPO_API_KEY`.
3. Abre `server.js` y edita el objeto `STORE_ADDRESS` con la dirección
   real desde donde vas a despachar los pedidos — Shippo la necesita para
   calcular tarifas y generar la guía.
4. Ajusta `DEFAULT_PARCEL` con las medidas y peso típicos de tus envíos
   (en modo prueba, cualquier valor funciona sin costo real).

### Probarlo sin necesidad de un pago real
```bash
curl -X POST http://localhost:4242/api/shipping-rates \
  -H "Content-Type: application/json" \
  -d '{
    "address_to": {
      "name": "Cliente de prueba",
      "street1": "215 Clayton St",
      "city": "San Francisco",
      "state": "CA",
      "zip": "94117",
      "country": "US"
    }
  }'
```
Con una clave de prueba (`shippo_test_...`), Shippo devuelve tarifas
simuladas de transportadoras reales, sin cobrar ni generar envíos de
verdad — perfecto para confirmar que la integración funciona antes de ir
a producción.

### Qué pasa si Shippo falla
El pedido se guarda igual con `shippingStatus: "error: ..."` para que no
pierdas la venta. Puedes reintentar la guía manualmente con:
```bash
curl -X POST http://localhost:4242/api/orders/ID_DEL_PEDIDO/create-label
```

### Ir a producción
Cuando actives claves "live" de Shippo, necesitarás conectar tu cuenta
con transportadoras reales (USPS, DHL, FedEx, o locales según el país)
desde el panel de Shippo — ellos gestionan esa parte, tú solo cambias la
clave en tu `.env`.

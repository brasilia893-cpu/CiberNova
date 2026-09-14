# PORT — Backend de pagos

Este servidor conecta tu tienda a **Stripe** para cobrar de verdad, y guarda
cada pedido pagado en `orders.json`. Es el paso que faltaba para que tu
página deje de ser una maqueta.

## 1. Requisitos
- Node.js instalado (v18 o más reciente) → https://nodejs.org
- Una cuenta gratuita en https://dashboard.stripe.com

## 2. Instalación
```bash
npm install
cp .env.example .env
```
Abre `.env` y pega tus claves de Stripe (Dashboard → Developers → API keys).
Mientras pruebas, usa las claves que empiezan con `sk_test_...`.

## 3. Ejecutar en tu computador
```bash
npm start
```
Tu servidor queda en `http://localhost:4242`.

## 4. Probar el webhook localmente
Stripe necesita avisarle a tu servidor cuando un pago se confirma. Para
probarlo en tu máquina, instala el Stripe CLI (https://stripe.com/docs/stripe-cli)
y corre:
```bash
stripe listen --forward-to localhost:4242/webhook
```
Eso te dará un `whsec_...` temporal — pégalo en tu `.env`.

## 5. Conectar tu página (port-tienda.html)
En tu página, el botón "Confirmar pedido" debe reemplazar la simulación
actual por una llamada real:
```js
const res = await fetch('http://localhost:4242/create-checkout-session', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ items: [{id: 1, qty: 2}, {id: 5, qty: 1}] })
});
const { url } = await res.json();
window.location.href = url; // Lleva al cliente a la página de pago de Stripe
```
Stripe se encarga de la pantalla de pago (ya cumple normas de seguridad
como PCI-DSS), así tu página nunca toca directamente los datos de la tarjeta.

## 6. Ir a producción
- Sube este backend a un servidor real: Render, Railway o Fly.io tienen
  planes gratuitos/económicos y son sencillos para empezar.
- Cambia tus claves de Stripe a las de modo "live" (`sk_live_...`).
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

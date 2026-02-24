const Stripe = require("stripe");

// Disable body parsing so we can read raw body for Stripe signature verification
const handler = async (req, res) => {
  if (req.method !== "POST") {
    return res.status(405).send("Method Not Allowed");
  }

  const secret = process.env.STRIPE_SECRET_KEY;
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secret || !webhookSecret) {
    return res.status(503).send("Webhook not configured");
  }

  const stripe = new Stripe(secret);
  const sig = req.headers["stripe-signature"];
  if (!sig) {
    return res.status(400).send("Webhook Error: Missing stripe-signature header");
  }

  // Read raw body (required for Stripe signature verification)
  const rawBody = await new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (chunk) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });

  let event;
  try {
    event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
  } catch (err) {
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  // Minimal handler (don't break anything yet)
  switch (event.type) {
    case "checkout.session.completed":
      // TODO: mark order paid / fulfill
      break;
    case "invoice.paid":
      // TODO: renewal logic
      break;
    default:
      break;
  }

  return res.status(200).json({ received: true });
};

handler.config = { api: { bodyParser: false } };
module.exports = handler;

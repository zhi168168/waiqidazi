import { createWebApp } from "./web-app.mjs";
import { createWebStore } from "./web-store.mjs";
const store = createWebStore();
const app = createWebApp({ store });
const host = process.env.HOST || "127.0.0.1";
app.server.listen(Number(process.env.PORT || 8838), host, () =>
  console.log(`网页版：http://${host}:${process.env.PORT || 8838}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, async () => {
    await app.close();
    process.exit(0);
  });

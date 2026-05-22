import express from "express";
import catalogRouter from "./catalog.js";
import contentRouter from "./content.js";
import { connectDb, seedData } from "./db.js";
import { setupLiveQueries } from "./notifications.js";

const app = express();
app.use(express.json());

app.use("/api/v1", catalogRouter);
app.use("/api/v1", contentRouter);

app.get("/health", (_req, res) => {
  res.json({ status: "ok" });
});

const PORT = process.env.PORT || 3000;

async function start() {
  await connectDb();
  await seedData();
  await setupLiveQueries();

  app.listen(PORT, () => {
    console.log(`SDA Backend API running on http://localhost:${PORT}`);
  });
}

start().catch(console.error);

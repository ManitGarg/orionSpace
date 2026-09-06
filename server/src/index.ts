import express from "express";
import cors from "cors";
import { api } from "./routes/api.js";
import { authRoutes } from "./routes/auth.js";
import { attachUser } from "./routes/authMiddleware.js";

const app = express();
app.use(cors());
app.use(express.json());

// Resolve the session for every request; individual routes decide what they
// require. Read-only analysis endpoints stay open so the 3D view keeps working,
// while anything that proposes or decides is permission-guarded.
app.use(attachUser);

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));
app.use("/api/auth", authRoutes);
app.use("/api", api);

const PORT = Number(process.env.PORT ?? 4000);
app.listen(PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`ORION server listening on :${PORT}`);
});

import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

const serverDir = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(serverDir, ".env") });
dotenv.config();

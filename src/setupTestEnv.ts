import { config } from "dotenv";

export default () => {
  config({ path: "./env/local.env" });
};

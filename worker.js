import handler from "./.open-next/worker.js";
import { authorizeAdmin } from "./src/cloudflare/admin-auth.js";

export { AuthObject } from "./src/cloudflare/auth-object.ts";

const worker = {
  async fetch(request, env, ctx) {
    const rejection = await authorizeAdmin(request, env);
    if (rejection) return rejection;
    return handler.fetch(request, env, ctx);
  },
};

export default worker;

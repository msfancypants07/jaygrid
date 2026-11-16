import { handle } from '../server/handler.mjs';
export default { fetch: request => handle(request, '/auth/callback') };

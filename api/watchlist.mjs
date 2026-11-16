import { handle } from '../server/handler.mjs';
export default { fetch: request => handle(request, '/api/watchlist') };

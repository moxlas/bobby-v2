import { routePartykitRequest } from 'partyserver';
import { BobbyRoom, type Env } from './server';

export { BobbyRoom };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const response = await routePartykitRequest(request, env);
    return response ?? new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

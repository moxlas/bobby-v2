import { routePartykitRequest } from 'partyserver';
import { BobbyRoom } from './server';
import { RoomDirectory } from './directory';
import type { Env } from './env';

export { BobbyRoom, RoomDirectory };

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const { pathname } = new URL(request.url);

    // Public room list; everything else is a PartyServer room socket.
    if (pathname === '/rooms') {
      const id = env.Directory.idFromName('global');
      return env.Directory.get(id).fetch(request);
    }

    const response = await routePartykitRequest(request, env);
    return response ?? new Response('Not Found', { status: 404 });
  },
} satisfies ExportedHandler<Env>;

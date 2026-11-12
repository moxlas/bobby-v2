import type { BobbyRoom } from './server';
import type { RoomDirectory } from './directory';

/** Bindings shared by the worker and both Durable Object classes. */
export interface Env {
  Main: DurableObjectNamespace<BobbyRoom>;
  Directory: DurableObjectNamespace<RoomDirectory>;
}

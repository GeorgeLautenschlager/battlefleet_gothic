import type { GameDO } from "./durable";

export type Env = {
  GAMES: DurableObjectNamespace<GameDO>;
  ALLOWED_ORIGINS: string;
  ENGINE_BUILD: string;
};

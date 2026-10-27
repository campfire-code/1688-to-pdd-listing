import { fileSrc } from '../kit/platform';
import { previewThumbs, type Env } from './env';
import type { Product } from './types';

export function thumbSrc(env: Env | null, p: Product, i = 0): string | undefined {
  if (!env) return undefined;
  if (env.preview) return previewThumbs[p.id]?.[i];
  const rel = p.localMain[i];
  return rel ? fileSrc(env.lib.imagePath(p, rel)) : undefined;
}

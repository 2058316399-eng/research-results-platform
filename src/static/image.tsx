import type { ImgHTMLAttributes } from "react";
import { assetUrl } from "./navigation";

/** GitHub Pages serves these bundled public images directly, without a server optimizer. */
export default function Image({ src, alt, ...props }: ImgHTMLAttributes<HTMLImageElement>) {
  return <img {...props} src={src ? assetUrl(src) : src} alt={alt ?? ""} />;
}

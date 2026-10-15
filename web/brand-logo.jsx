import React from "react";

export default function BrandLogo({ className = "", sizes = "43px" }) {
  return (
    <img
      className={`brand-logo ${className}`.trim()}
      src="/brand/logo-96.webp"
      srcSet="/brand/logo-96.webp 96w, /brand/logo-192.webp 192w"
      sizes={sizes}
      width="43"
      height="43"
      alt=""
    />
  );
}

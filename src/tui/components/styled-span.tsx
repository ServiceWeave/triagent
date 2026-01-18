/* @jsxImportSource @opentui/solid */
/**
 * Styled span component that properly types fg/bg/attributes props.
 * This is a workaround for @opentui/solid's SpanProps not including TextNodeOptions.
 */

import type { JSX } from "solid-js";
import type { RGBA } from "@opentui/core";

export interface StyledSpanProps {
  children?: JSX.Element | string | number | (JSX.Element | string | number)[];
  fg?: string | RGBA;
  bg?: string | RGBA;
  attributes?: number;
}

/**
 * A span element with proper typing for fg, bg, and attributes props.
 * Use this instead of <span> when you need color styling.
 */
export function StyledSpan(props: StyledSpanProps): JSX.Element {
  // Cast to any to bypass type checking since the runtime supports these props
  return <span {...(props as any)} />;
}

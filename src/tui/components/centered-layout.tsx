/* @jsxImportSource @opentui/solid */
import type { JSX, ParentProps } from "solid-js";
import { layout } from "../theme/index.js";

export interface CenteredLayoutProps extends ParentProps {
  maxWidth?: number;
}

/**
 * CenteredLayout - Wrapper component providing centered max-width container
 * Creates a centered layout with optional max-width constraint
 */
export function CenteredLayout(props: CenteredLayoutProps): JSX.Element {
  const maxWidth = props.maxWidth ?? layout.maxWidth;

  return (
    <box
      flexDirection="row"
      justifyContent="center"
      width="100%"
      height="100%"
    >
      <box
        flexDirection="column"
        width="100%"
        height="100%"
        maxWidth={maxWidth}
      >
        {props.children}
      </box>
    </box>
  );
}

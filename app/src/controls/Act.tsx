import { validate, type GameState, type Transform } from "@bfg/engine";

/**
 * A button that sends one transform. The engine decides whether it's legal:
 * an illegal one is disabled, with the validator's reason as its tooltip.
 */
export function Act({
  state,
  transform,
  onApply,
  children,
  primary = false,
  showReason = false,
}: {
  state: GameState;
  transform: Transform;
  onApply: (t: Transform) => void;
  children: React.ReactNode;
  primary?: boolean;
  /** Show the reason under the button instead of only as a tooltip. */
  showReason?: boolean;
}) {
  const v = validate(state, transform);
  const reason = v.ok ? undefined : v.reason.message;
  return (
    <span className="act">
      <button type="button" className={primary ? "primary" : undefined} disabled={!v.ok} title={reason} onClick={() => onApply(transform)}>
        {children}
      </button>
      {showReason && reason !== undefined && <small className="muted">{reason}</small>}
    </span>
  );
}

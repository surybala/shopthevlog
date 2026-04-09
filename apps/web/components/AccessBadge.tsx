type AccessBadgeTone = 'tier' | 'reason' | 'status';

const toneClasses: Record<AccessBadgeTone, string> = {
  tier: 'bg-black/60 text-white/70',
  reason: 'bg-green-500/15 text-green-200 border border-green-400/20',
  status: 'bg-green-500/15 text-green-200',
};

type AccessBadgeProps = {
  label: string;
  tone?: AccessBadgeTone;
  className?: string;
};

export default function AccessBadge({
  label,
  tone = 'tier',
  className = '',
}: AccessBadgeProps) {
  return (
    <span
      className={`text-xs px-2 py-0.5 rounded-full ${toneClasses[tone]} ${className}`.trim()}
    >
      {label}
    </span>
  );
}

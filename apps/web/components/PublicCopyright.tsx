export default function PublicCopyright({
  className = '',
}: {
  className?: string
}) {
  return (
    <p className={className.trim() || 'text-xs text-[#17332d]/42'}>
      Copyright 2026 VlogShopper. All rights reserved.
    </p>
  )
}

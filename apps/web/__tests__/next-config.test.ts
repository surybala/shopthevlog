import { describe, expect, it } from 'vitest';

describe('next config', async () => {
  const { default: nextConfig } = await import('../next.config.mjs');

  it('uses the Next 14 experimental external packages key', () => {
    expect(nextConfig.experimental.serverComponentsExternalPackages).toEqual(
      expect.arrayContaining([
        '@prisma/client',
        'prisma',
        '@prisma/adapter-pg',
        'nodemailer',
      ]),
    );
  });

  it('does not use the unsupported top-level external packages key', () => {
    expect(nextConfig).not.toHaveProperty('serverExternalPackages');
  });

  it('builds as a standalone server bundle for container deployment', () => {
    expect(nextConfig.output).toBe('standalone');
  });
});

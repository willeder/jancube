import { join } from 'node:path'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Workspace packages are published as TypeScript source.
  transpilePackages: ['@jancube/domain', '@jancube/application', '@jancube/infrastructure'],
  // Monorepo: trace server dependencies from the repository root.
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
}

export default nextConfig

// Makes Cloudflare bindings (e.g. HYPERDRIVE) available to `next dev` via getCloudflareContext().
initOpenNextCloudflareForDev()

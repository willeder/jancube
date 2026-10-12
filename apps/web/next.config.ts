import { join } from 'node:path'
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare'
import type { NextConfig } from 'next'

const nextConfig: NextConfig = {
  // Workspace packages are published as TypeScript source.
  transpilePackages: ['@jancube/domain', '@jancube/application', '@jancube/infrastructure'],
  // Monorepo: trace server dependencies from the repository root.
  outputFileTracingRoot: join(import.meta.dirname, '../..'),
  // Do not let `next dev` write editor-assistant rule files into the project.
  agentRules: false,
  async headers() {
    return [
      {
        // C-23: the availability widget may be framed by the stores' WordPress site. Restrict
        // frame-ancestors to the client's domain once it is confirmed (Q-01).
        source: '/embed/:path*',
        headers: [{ key: 'Content-Security-Policy', value: 'frame-ancestors *' }],
      },
    ]
  },
}

export default nextConfig

// Makes Cloudflare bindings (e.g. HYPERDRIVE) available to `next dev` via getCloudflareContext().
initOpenNextCloudflareForDev()

import { withContainer } from '@/server/container'
import { isDomainError } from '@/server/errors'

/**
 * LINE Messaging API webhook (F-LINE-05 follow/unfollow, guidance reply). The raw body is needed
 * for the x-line-signature check. 400 for an invalid signature; 5xx makes LINE redeliver (when
 * redelivery is enabled in the LINE Developers console).
 */
export async function POST(request: Request) {
  const body = await request.text()
  const signature = request.headers.get('x-line-signature')
  try {
    const result = await withContainer((c) => c.handleLineWebhook(body, signature))
    return Response.json(result)
  } catch (error) {
    if (isDomainError(error, 'line_not_configured')) {
      return Response.json({ error: 'LINE is not configured' }, { status: 503 })
    }
    const message = error instanceof Error ? error.message : String(error)
    const unauthentic = /signature|malformed/i.test(message)
    console.error('line webhook failed:', message)
    return Response.json(
      { error: unauthentic ? 'invalid signature' : 'processing failed' },
      { status: unauthentic ? 400 : 500 },
    )
  }
}

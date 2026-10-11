import { createServerFn } from '@tanstack/react-start'
import { withContainer } from './container'

export const listStores = createServerFn({ method: 'GET' }).handler(() =>
  withContainer((c) => c.listStores()),
)

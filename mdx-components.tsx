import type { MDXComponents } from 'mdx/types'
import { Steps, Callout, Screenshot, Video } from '@/components/help/mdx'

export function useMDXComponents(components: MDXComponents): MDXComponents {
  return {
    Steps,
    Callout,
    Screenshot,
    Video,
    ...components,
  }
}

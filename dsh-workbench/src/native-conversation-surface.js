import { Component, createElement, useSyncExternalStore } from 'react'
import { createPortal } from 'react-dom'

// A native extension failure must not take down the workbench or DSH shell.
class NativeSurfaceBoundary extends Component {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() {
    return this.state.failed
      ? createElement('div', { role: 'alert', style: { padding: 20 } }, '原生会话视图加载失败，请刷新重试。任务记录仍保留，不会创建替代会话。')
      : this.props.children
  }
}

/** Decorate the registered native component through the public slot registry.
 * A React portal keeps the native providers, renderer, tools and interactions;
 * no existing DOM nodes or transcript text are copied into the workbench.
 */
export function installNativeConversationSurface(ctx) {
  const slots = ctx.get('slots')
  let target = null
  const listeners = new Set()
  const subscribe = fn => { listeners.add(fn); return () => listeners.delete(fn) }
  const snapshot = () => target
  const decorators = [], watchers = new Set()
  const alias = name => 'workbench.native.' + name
  // Native slots have single declaration owners. Mount a namespaced composition
  // of the SAME registered components, preserving their native stores/actions.
  // Never redeclare the host's own conversation.* seats.
  function mirror(name) {
    if (watchers.has(name)) return
    watchers.add(name)
    const mounted = new Map()
    const sync = () => {
      const entries = slots.entries(name)
      for (const [entry, dispose] of mounted) if (!entries.includes(entry)) { dispose(); mounted.delete(entry) }
      for (const entry of entries) {
        if (mounted.has(entry)) continue
        const children = entry.children && Object.fromEntries(Object.entries(entry.children).map(([key, spec]) => [alias(key), spec]))
        const dispose = slots.register({ name: alias(name), ...entry.options,
          children, inject: entry.inject, store: entry.store, locale: entry.locale, select: entry.select,
        }, function NativeWorkbenchComponent(props) {
          if (name === 'conversation.composer.bar' || name === 'conversation.session.header') return null
          const mapped = { ...props }
          if (props.renderSlot) mapped.renderSlot = (key, owner, options) => props.renderSlot(alias(key), owner, options)
          if (props.renderSlotChain) mapped.renderSlotChain = (key, owner, options) => props.renderSlotChain(alias(key), owner, options)
          return createElement(entry.component, mapped)
        })
        mounted.set(entry, dispose)
        for (const key of Object.keys(entry.children ?? {})) mirror(key)
      }
    }
    decorators.push(slots.subscribe(name, sync), () => { for (const dispose of mounted.values()) dispose() })
    sync()
  }
  decorators.push(slots.register({ name: 'shell.overlay', id: 'workbench-native-surface',
    children: { [alias('conversation')]: slots.spec('conversation') },
  }, function NativeSurface({ renderSlot }) {
    const seat = useSyncExternalStore(subscribe, snapshot, snapshot)
    return seat ? createPortal(createElement(NativeSurfaceBoundary, null, renderSlot(alias('conversation'), {})), seat) : null
  }))
  mirror('conversation')
  return {
    setTarget(next) {
      if (next === target) return
      target = next
      listeners.forEach(fn => fn())
    },
    dispose() { target = null; decorators.reverse().forEach(dispose => dispose()); listeners.clear() },
  }
}

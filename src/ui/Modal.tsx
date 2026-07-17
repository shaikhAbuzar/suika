import type { ReactNode } from "react"
import { useTerminalDimensions } from "@opentui/react"
import { theme } from "./theme.ts"

interface Props {
  title: string
  width?: number
  height?: number
  children: ReactNode
}

/** Centered overlay box drawn above the panes. */
export function Modal({ title, width, height, children }: Props) {
  const dims = useTerminalDimensions()
  const w = Math.min(width ?? 60, dims.width - 4)
  const h = height !== undefined ? Math.min(height, dims.height - 2) : undefined
  return (
    <box
      position="absolute"
      left={Math.max(0, Math.floor((dims.width - w) / 2))}
      top={Math.max(0, Math.floor((dims.height - (h ?? 10)) / 2))}
      width={w}
      height={h}
      zIndex={100}
      border
      borderColor={theme.overlayBorder}
      title={` ${title} `}
      titleColor={theme.titleActive}
      backgroundColor={theme.overlayBg}
      flexDirection="column"
      padding={1}
    >
      {children}
    </box>
  )
}

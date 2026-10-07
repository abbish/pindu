import {
  CircleCheckIcon,
  InfoIcon,
  Loader2Icon,
  OctagonXIcon,
  TriangleAlertIcon,
} from "lucide-react"
import { useTheme } from "@/hooks/useTheme"
import { Toaster as Sonner, type ToasterProps } from "sonner"

const Toaster = ({ ...props }: ToasterProps) => {
  // 主题跟随 useTheme（data-theme），本项目不用 next-themes
  const { theme } = useTheme()

  return (
    <Sonner
      theme={theme}
      className="toaster group"
      icons={{
        // 只给图标上色区分类型，卡片保持中性（不用 richColors 的整块底色）
        success: <CircleCheckIcon className="size-4 text-success" />,
        info: <InfoIcon className="size-4 text-muted-foreground" />,
        warning: <TriangleAlertIcon className="size-4 text-warning" />,
        error: <OctagonXIcon className="size-4 text-destructive" />,
        loading: <Loader2Icon className="size-4 animate-spin" />,
      }}
      style={
        {
          "--normal-bg": "var(--popover)",
          "--normal-text": "var(--popover-foreground)",
          "--normal-border": "var(--border)",
          "--border-radius": "var(--radius)",
        } as React.CSSProperties
      }
      {...props}
    />
  )
}

export { Toaster }

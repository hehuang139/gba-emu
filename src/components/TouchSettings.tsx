import { useId } from 'react'
import { defaultTouchConfig, normalizeTouchConfig } from '../lib/touch'
import type { TouchConfig } from '../lib/touch'
import './touch-controls.css'

export function TouchSettings({
  config,
  onChange,
}: {
  config: TouchConfig
  onChange: (config: TouchConfig) => void
}) {
  const id = useId()
  const current = normalizeTouchConfig(config)
  const change = (patch: Partial<TouchConfig>) =>
    onChange(normalizeTouchConfig({ ...current, ...patch }))
  return (
    <fieldset className="advance-touch-settings">
      <legend>触屏手柄配置</legend>
      <div className="advance-touch-setting">
        <label htmlFor={`${id}-layout`}>触屏布局</label>
        <select
          id={`${id}-layout`}
          value={current.layout}
          onChange={(event) => change({ layout: event.target.value as TouchConfig['layout'] })}
        >
          <option value="standard">标准布局</option>
          <option value="compact">紧凑布局</option>
        </select>
      </div>
      <div className="advance-touch-setting">
        <label htmlFor={`${id}-scale`}>
          按键大小 <output htmlFor={`${id}-scale`}>{Math.round(current.scale * 100)}%</output>
        </label>
        <input
          id={`${id}-scale`}
          aria-label="触屏按键大小"
          aria-valuetext={`${Math.round(current.scale * 100)}%`}
          type="range"
          min="80"
          max="130"
          step="5"
          value={Math.round(current.scale * 100)}
          onChange={(event) => change({ scale: Number(event.target.value) / 100 })}
        />
      </div>
      <div className="advance-touch-setting">
        <label htmlFor={`${id}-opacity`}>
          按键不透明度{' '}
          <output htmlFor={`${id}-opacity`}>{Math.round(current.opacity * 100)}%</output>
        </label>
        <input
          id={`${id}-opacity`}
          aria-label="触屏按键不透明度"
          aria-valuetext={`${Math.round(current.opacity * 100)}%`}
          type="range"
          min="40"
          max="100"
          step="5"
          value={Math.round(current.opacity * 100)}
          onChange={(event) => change({ opacity: Number(event.target.value) / 100 })}
        />
      </div>
      <p className="advance-touch-hint">
        手机自动显示触屏手柄。紧凑布局减少高度；窄屏会自动限制按键尺寸，避免横向溢出。
      </p>
      <button
        type="button"
        className="advance-touch-reset"
        onClick={() => onChange({ ...defaultTouchConfig })}
      >
        恢复默认触屏配置
      </button>
    </fieldset>
  )
}

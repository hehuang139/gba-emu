/** Library metadata. Dates use epoch milliseconds; playTime uses seconds. */
export interface Game {
  id: string
  title: string
  filename: string
  size: number
  addedAt: number
  lastPlayed: number | null
  playTime: number
  favorite: boolean
  color?: string
}

export interface SaveState {
  id: string
  gameId: string
  slot: number
  data: Uint8Array
  screenshot?: string
  createdAt: number
}

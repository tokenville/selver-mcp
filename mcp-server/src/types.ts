export type Product = {
  sku: string
  name: string
  price: number
  special_price: number | null
  unit: string | null
  brand: string | null
  category_ids: number[]
  product_id: number | null
  stock_status: number | null
  url_path?: string
  image?: string
}

export type CartItem = {
  item_id: number
  sku: string
  qty: number
  name: string
  price: number
  product_type: string
}

export type TokenData = {
  token: string | null
  cart_token: string | null
  cookies: Record<string, string>
  user?: Record<string, any>
  id_code?: string
  saved_at?: number
}


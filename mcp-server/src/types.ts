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

export type PantryItem = {
  id?: string
  name: string
  quantity?: number
  unit?: string
  category?: string
  image?: string
  added?: string
}

export type FamilyMember = {
  name: string
  age: number
  role: 'adult' | 'child'
  notes?: string
}

export type Pet = {
  type: string
  breed?: string
  age: number
}

export type FamilyConfig = {
  family: {
    adults: number
    children: number
    members: FamilyMember[]
    pets: Pet[]
    preferences: string[]
    allergies: string[]
    dietary: string[]
  }
  address: {
    street: string
    city: string
    region: string
    country: string
    postcode: string
  }
  selver: {
    email: string
    delivery_postcode: string
  }
  meal_planning: {
    language: string
    cuisine_preferences: string[]
    meals_per_day: string[]
    budget_per_week_eur: number
    notes: string
  }
}

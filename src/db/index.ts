// Database with Neon Postgres for persistence (via pg-kv key-value store)
// Falls back to in-memory storage for local development

import { v4 as uuidv4 } from 'uuid'
import {
  kvGet, kvSet,
  kvLpush, kvLrange, isDbConfigured
} from '@/lib/pg-kv'

export interface User {
  id: string
  email: string
  passwordHash: string
  name: string | null
  createdAt: string
  termsAcceptedAt: string | null
  questionCount: number
}

export interface Subscription {
  id: string
  userId: string
  stripeCustomerId: string | null
  stripeSubscriptionId: string | null
  stripePriceId: string | null
  status: string
  currentPeriodStart: string | null
  currentPeriodEnd: string | null
  cancelAtPeriodEnd: boolean
  createdAt: string
  updatedAt: string
}

export interface Referral {
  id: string
  code: string
  partnerName: string
  partnerEmail: string | null
  commissionPercent: number
  active: boolean
  createdAt: string
}

export interface ReferralConversion {
  id: string
  referralId: string
  referralCode: string
  userId: string
  stripeSubscriptionId: string | null
  status: 'signed_up' | 'subscribed' | 'churned'
  createdAt: string
  subscribedAt: string | null
}

export interface Conversation {
  id: string
  userId: string
  title: string | null
  createdAt: string
  updatedAt: string
}

export interface Message {
  id: string
  conversationId: string
  role: 'user' | 'assistant'
  content: string
  timestamp: string
}



// In-memory fallback storage for local development
const memoryUsers: Map<string, User> = new Map()
const memorySubscriptions: Map<string, Subscription> = new Map()
const memoryReferrals: Map<string, Referral> = new Map()
const memoryReferralConversions: Map<string, ReferralConversion> = new Map()
const memoryConversations: Map<string, Conversation> = new Map()
const memoryMessages: Map<string, Message> = new Map()

// User operations
export const db = {
  users: {
    create: async (data: Omit<User, 'id' | 'createdAt'>): Promise<User> => {
      const user: User = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        ...data,
      }
      
      if (isDbConfigured()) {
        await kvSet(`user:${user.id}`, JSON.stringify(user))
        await kvSet(`user_email:${user.email.toLowerCase()}`, user.id)
      } else {
        memoryUsers.set(user.id, user)
      }
      
      return user
    },
    
    findByEmail: async (email: string): Promise<User | undefined> => {
      if (isDbConfigured()) {
        const userId = await kvGet(`user_email:${email.toLowerCase()}`)
        if (!userId) return undefined
        const userData = await kvGet(`user:${userId}`)
        if (!userData) return undefined
        return JSON.parse(userData) as User
      } else {
        return Array.from(memoryUsers.values()).find(u => u.email.toLowerCase() === email.toLowerCase())
      }
    },
    
    findById: async (id: string): Promise<User | undefined> => {
      if (isDbConfigured()) {
        const userData = await kvGet(`user:${id}`)
        if (!userData) return undefined
        return JSON.parse(userData) as User
      } else {
        return memoryUsers.get(id)
      }
    },
    
    update: async (id: string, data: Partial<User>): Promise<User | undefined> => {
      if (isDbConfigured()) {
        const existing = await db.users.findById(id)
        if (!existing) return undefined
        const updated = { ...existing, ...data }
        await kvSet(`user:${id}`, JSON.stringify(updated))
        return updated
      } else {
        const user = memoryUsers.get(id)
        if (!user) return undefined
        const updated = { ...user, ...data }
        memoryUsers.set(id, updated)
        return updated
      }
    },
  },
  
  subscriptions: {
    create: async (data: Omit<Subscription, 'id' | 'createdAt' | 'updatedAt'>): Promise<Subscription> => {
      const subscription: Subscription = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      }
      
      if (isDbConfigured()) {
        await kvSet(`subscription:${subscription.id}`, JSON.stringify(subscription))
        await kvSet(`sub_user:${subscription.userId}`, subscription.id)
        if (subscription.stripeSubscriptionId) {
          await kvSet(`sub_stripe:${subscription.stripeSubscriptionId}`, subscription.id)
        }
        if (subscription.stripeCustomerId) {
          await kvSet(`sub_customer:${subscription.stripeCustomerId}`, subscription.id)
        }
      } else {
        memorySubscriptions.set(subscription.id, subscription)
      }
      
      return subscription
    },
    
    findByUserId: async (userId: string): Promise<Subscription | undefined> => {
      if (isDbConfigured()) {
        const subId = await kvGet(`sub_user:${userId}`)
        if (!subId) return undefined
        const subData = await kvGet(`subscription:${subId}`)
        if (!subData) return undefined
        return JSON.parse(subData) as Subscription
      } else {
        return Array.from(memorySubscriptions.values()).find(s => s.userId === userId)
      }
    },
    
    findByStripeSubscriptionId: async (stripeSubscriptionId: string): Promise<Subscription | undefined> => {
      if (isDbConfigured()) {
        const subId = await kvGet(`sub_stripe:${stripeSubscriptionId}`)
        if (!subId) return undefined
        const subData = await kvGet(`subscription:${subId}`)
        if (!subData) return undefined
        return JSON.parse(subData) as Subscription
      } else {
        return Array.from(memorySubscriptions.values()).find(s => s.stripeSubscriptionId === stripeSubscriptionId)
      }
    },
    
    findByStripeCustomerId: async (stripeCustomerId: string): Promise<Subscription | undefined> => {
      if (isDbConfigured()) {
        const subId = await kvGet(`sub_customer:${stripeCustomerId}`)
        if (!subId) return undefined
        const subData = await kvGet(`subscription:${subId}`)
        if (!subData) return undefined
        return JSON.parse(subData) as Subscription
      } else {
        return Array.from(memorySubscriptions.values()).find(s => s.stripeCustomerId === stripeCustomerId)
      }
    },
    
    update: async (id: string, data: Partial<Subscription>): Promise<Subscription | undefined> => {
      if (isDbConfigured()) {
        const subData = await kvGet(`subscription:${id}`)
        if (!subData) return undefined
        const existing = JSON.parse(subData) as Subscription
        const updated = { ...existing, ...data, updatedAt: new Date().toISOString() }
        await kvSet(`subscription:${id}`, JSON.stringify(updated))
        return updated
      } else {
        const subscription = memorySubscriptions.get(id)
        if (!subscription) return undefined
        const updated = { ...subscription, ...data, updatedAt: new Date().toISOString() }
        memorySubscriptions.set(id, updated)
        return updated
      }
    },
    
    updateByStripeSubscriptionId: async (stripeSubscriptionId: string, data: Partial<Subscription>): Promise<Subscription | undefined> => {
      const subscription = await db.subscriptions.findByStripeSubscriptionId(stripeSubscriptionId)
      if (!subscription) return undefined
      return db.subscriptions.update(subscription.id, data)
    },
  },
  
  referrals: {
    create: async (data: Omit<Referral, 'id' | 'createdAt'>): Promise<Referral> => {
      const referral: Referral = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        ...data,
      }

      if (isDbConfigured()) {
        await kvSet(`referral:${referral.id}`, JSON.stringify(referral))
        await kvSet(`referral_code:${referral.code.toLowerCase()}`, referral.id)
        await kvLpush('referral_list', referral.id)
      } else {
        memoryReferrals.set(referral.id, referral)
      }

      return referral
    },

    findByCode: async (code: string): Promise<Referral | undefined> => {
      if (isDbConfigured()) {
        const referralId = await kvGet(`referral_code:${code.toLowerCase()}`)
        if (!referralId) return undefined
        const data = await kvGet(`referral:${referralId}`)
        if (!data) return undefined
        return JSON.parse(data) as Referral
      } else {
        return Array.from(memoryReferrals.values()).find(r => r.code.toLowerCase() === code.toLowerCase())
      }
    },

    findById: async (id: string): Promise<Referral | undefined> => {
      if (isDbConfigured()) {
        const data = await kvGet(`referral:${id}`)
        if (!data) return undefined
        return JSON.parse(data) as Referral
      } else {
        return memoryReferrals.get(id)
      }
    },

    listAll: async (): Promise<Referral[]> => {
      if (isDbConfigured()) {
        const ids = await kvLrange('referral_list', 0, -1)
        if (!ids || ids.length === 0) return []
        const referrals: Referral[] = []
        for (const id of ids) {
          const data = await kvGet(`referral:${id}`)
          if (data) {
            referrals.push(JSON.parse(data) as Referral)
          }
        }
        return referrals.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      } else {
        return Array.from(memoryReferrals.values())
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      }
    },

    update: async (id: string, data: Partial<Referral>): Promise<Referral | undefined> => {
      if (isDbConfigured()) {
        const existing = await db.referrals.findById(id)
        if (!existing) return undefined
        const updated = { ...existing, ...data }
        await kvSet(`referral:${id}`, JSON.stringify(updated))
        return updated
      } else {
        const referral = memoryReferrals.get(id)
        if (!referral) return undefined
        const updated = { ...referral, ...data }
        memoryReferrals.set(id, updated)
        return updated
      }
    },
  },

  referralConversions: {
    create: async (data: Omit<ReferralConversion, 'id' | 'createdAt'>): Promise<ReferralConversion> => {
      const conversion: ReferralConversion = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        ...data,
      }

      if (isDbConfigured()) {
        await kvSet(`ref_conversion:${conversion.id}`, JSON.stringify(conversion))
        await kvSet(`ref_conv_user:${conversion.userId}`, conversion.id)
        await kvLpush(`ref_conversions:${conversion.referralId}`, conversion.id)
      } else {
        memoryReferralConversions.set(conversion.id, conversion)
      }

      return conversion
    },

    findByUserId: async (userId: string): Promise<ReferralConversion | undefined> => {
      if (isDbConfigured()) {
        const convId = await kvGet(`ref_conv_user:${userId}`)
        if (!convId) return undefined
        const data = await kvGet(`ref_conversion:${convId}`)
        if (!data) return undefined
        return JSON.parse(data) as ReferralConversion
      } else {
        return Array.from(memoryReferralConversions.values()).find(c => c.userId === userId)
      }
    },

    findByReferralId: async (referralId: string): Promise<ReferralConversion[]> => {
      if (isDbConfigured()) {
        const ids = await kvLrange(`ref_conversions:${referralId}`, 0, -1)
        if (!ids || ids.length === 0) return []
        const conversions: ReferralConversion[] = []
        for (const id of ids) {
          const data = await kvGet(`ref_conversion:${id}`)
          if (data) {
            conversions.push(JSON.parse(data) as ReferralConversion)
          }
        }
        return conversions.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      } else {
        return Array.from(memoryReferralConversions.values())
          .filter(c => c.referralId === referralId)
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
      }
    },

    update: async (id: string, data: Partial<ReferralConversion>): Promise<ReferralConversion | undefined> => {
      if (isDbConfigured()) {
        const existingData = await kvGet(`ref_conversion:${id}`)
        if (!existingData) return undefined
        const existing = JSON.parse(existingData) as ReferralConversion
        const updated = { ...existing, ...data }
        await kvSet(`ref_conversion:${id}`, JSON.stringify(updated))
        return updated
      } else {
        const conversion = memoryReferralConversions.get(id)
        if (!conversion) return undefined
        const updated = { ...conversion, ...data }
        memoryReferralConversions.set(id, updated)
        return updated
      }
    },

    updateByUserId: async (userId: string, data: Partial<ReferralConversion>): Promise<ReferralConversion | undefined> => {
      const conversion = await db.referralConversions.findByUserId(userId)
      if (!conversion) return undefined
      return db.referralConversions.update(conversion.id, data)
    },
  },

  conversations: {
    create: async (data: Omit<Conversation, 'id' | 'createdAt' | 'updatedAt'>): Promise<Conversation> => {
      const conversation: Conversation = {
        id: uuidv4(),
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        ...data,
      }
      
      if (isDbConfigured()) {
        await kvSet(`conversation:${conversation.id}`, JSON.stringify(conversation))
        await kvLpush(`user_conversations:${conversation.userId}`, conversation.id)
      } else {
        memoryConversations.set(conversation.id, conversation)
      }
      
      return conversation
    },
    
    findByUserId: async (userId: string): Promise<Conversation[]> => {
      if (isDbConfigured()) {
        const convIds = await kvLrange(`user_conversations:${userId}`, 0, -1)
        if (!convIds || convIds.length === 0) return []
        const conversations: Conversation[] = []
        for (const id of convIds) {
          const convData = await kvGet(`conversation:${id}`)
          if (convData) {
            conversations.push(JSON.parse(convData) as Conversation)
          }
        }
        return conversations.sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      } else {
        return Array.from(memoryConversations.values())
          .filter(c => c.userId === userId)
          .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime())
      }
    },
    
    findById: async (id: string): Promise<Conversation | undefined> => {
      if (isDbConfigured()) {
        const convData = await kvGet(`conversation:${id}`)
        if (!convData) return undefined
        return JSON.parse(convData) as Conversation
      } else {
        return memoryConversations.get(id)
      }
    },
    
    update: async (id: string, data: Partial<Conversation>): Promise<Conversation | undefined> => {
      if (isDbConfigured()) {
        const convData = await kvGet(`conversation:${id}`)
        if (!convData) return undefined
        const existing = JSON.parse(convData) as Conversation
        const updated = { ...existing, ...data, updatedAt: new Date().toISOString() }
        await kvSet(`conversation:${id}`, JSON.stringify(updated))
        return updated
      } else {
        const conversation = memoryConversations.get(id)
        if (!conversation) return undefined
        const updated = { ...conversation, ...data, updatedAt: new Date().toISOString() }
        memoryConversations.set(id, updated)
        return updated
      }
    },
  },
  
  messages: {
    create: async (data: Omit<Message, 'id' | 'timestamp'>): Promise<Message> => {
      const message: Message = {
        id: uuidv4(),
        timestamp: new Date().toISOString(),
        ...data,
      }
      
      if (isDbConfigured()) {
        await kvSet(`message:${message.id}`, JSON.stringify(message))
        await kvLpush(`conversation_messages:${message.conversationId}`, message.id)
      } else {
        memoryMessages.set(message.id, message)
      }
      
      return message
    },
    
    findByConversationId: async (conversationId: string): Promise<Message[]> => {
      if (isDbConfigured()) {
        const msgIds = await kvLrange(`conversation_messages:${conversationId}`, 0, -1)
        if (!msgIds || msgIds.length === 0) return []
        const messages: Message[] = []
        for (const id of msgIds) {
          const msgData = await kvGet(`message:${id}`)
          if (msgData) {
            messages.push(JSON.parse(msgData) as Message)
          }
        }
        return messages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      } else {
        return Array.from(memoryMessages.values())
          .filter(m => m.conversationId === conversationId)
          .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      }
    },
  },
}

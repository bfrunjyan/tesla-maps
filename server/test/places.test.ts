import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { sql } from '../db.ts'
import { client, place, resetDatabase } from './helpers.ts'

beforeEach(resetDatabase)
afterAll(() => sql.end())

async function signedIn(email = 'd@example.com') {
  const c = client()
  await c.post('/api/auth/register', { email, password: 'longenough' })
  return c
}

describe('saved places', () => {
  it('requires sign-in', async () => {
    expect((await client().get('/api/places')).status).toBe(401)
    expect((await client().put('/api/places/home', { place: place('H') })).status).toBe(401)
  })

  it('sets, replaces and clears Home and Work', async () => {
    const c = await signedIn()
    await c.put('/api/places/home', { place: place('H1', 'First home') })
    await c.put('/api/places/home', { place: place('H2', 'New home') })
    await c.put('/api/places/work', { place: place('W1', 'Office') })
    let all = (await c.get('/api/places')).json
    expect(all.home.name).toBe('New home')
    expect(all.work.name).toBe('Office')
    await c.put('/api/places/work', { place: null })
    all = (await c.get('/api/places')).json
    expect(all.work).toBeNull()
  })

  it('adds and removes favorites without duplicates', async () => {
    const c = await signedIn()
    await c.post('/api/places/favorites', place('F1'))
    await c.post('/api/places/favorites', place('F1'))
    await c.post('/api/places/favorites', place('F2'))
    expect((await c.get('/api/places')).json.favorites.map((p: { id: string }) => p.id).sort()).toEqual(['F1', 'F2'])
    await c.del('/api/places/favorites/F1')
    expect((await c.get('/api/places')).json.favorites.map((p: { id: string }) => p.id)).toEqual(['F2'])
  })

  it('renames a favorite in place (same entry, new name)', async () => {
    const c = await signedIn()
    const pin = place('pin-44.50883,40.16851', 'Dropped pin')
    await c.post('/api/places/favorites', pin)
    await c.post('/api/places/favorites', { ...pin, name: 'Music Station' })
    const favorites = (await c.get('/api/places')).json.favorites
    expect(favorites).toHaveLength(1)
    expect(favorites[0]).toMatchObject({ id: pin.id, name: 'Music Station' })
  })

  it('keeps the 25 most recent destinations, newest first', async () => {
    const c = await signedIn()
    for (let i = 1; i <= 30; i++) await c.post('/api/places/recents', place(`R${i}`))
    const recents = (await c.get('/api/places')).json.recents
    expect(recents).toHaveLength(25)
    expect(recents[0].id).toBe('R30')
    expect(recents.some((p: { id: string }) => p.id === 'R5')).toBe(false)
  })

  it('validates places', async () => {
    const c = await signedIn()
    expect((await c.post('/api/places/favorites', { id: 'X', name: 'Bad', lon: 999, lat: 0 })).status).toBe(400)
    expect((await c.post('/api/places/favorites', { id: '', name: 'No id', lon: 44, lat: 40 })).status).toBe(400)
    expect((await c.put('/api/places/home', { place: { id: 'X', name: '', lon: 44, lat: 40 } })).status).toBe(400)
  })

  it('keeps each account’s places separate', async () => {
    const a = await signedIn('a@example.com')
    const b = await signedIn('b@example.com')
    await a.post('/api/places/favorites', place('A-only'))
    expect((await b.get('/api/places')).json.favorites).toEqual([])
  })

  it('merges places saved on the car before sign-in; account Home wins', async () => {
    const c = await signedIn()
    await c.put('/api/places/home', { place: place('ACCOUNT-HOME', 'Account home') })
    await c.post('/api/places/favorites', place('F-account'))
    const merged = (
      await c.post('/api/places/import', {
        home: place('CAR-HOME', 'Car home'),
        work: place('CAR-WORK', 'Car work'),
        favorites: [place('F-car'), place('F-account')],
        recents: [place('R-car')],
      })
    ).json
    expect(merged.home.id).toBe('ACCOUNT-HOME')
    expect(merged.work.id).toBe('CAR-WORK')
    expect(merged.favorites.map((p: { id: string }) => p.id).sort()).toEqual(['F-account', 'F-car'])
    expect(merged.recents.map((p: { id: string }) => p.id)).toEqual(['R-car'])
  })
})

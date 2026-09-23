// FE-TSTORE-001 to FE-TSTORE-021 (trip-scoped root store: load, hydrate, refresh, mutate)
import { http, HttpResponse } from 'msw';
import { server } from '../../tests/helpers/msw/server';
import { resetAllStores, seedStore } from '../../tests/helpers/store';
import {
  buildAssignment,
  buildBudgetItem,
  buildCategory,
  buildDay,
  buildDayNote,
  buildPackingItem,
  buildPlace,
  buildReservation,
  buildTag,
  buildTodoItem,
  buildTrip,
  buildTripFile,
} from '../../tests/helpers/factories';
import { offlineDb, upsertDays, upsertPlaces, upsertTrip } from '../db/offlineDb';
import { randomId } from '../utils/randomId';
import { setForcedOffline } from '../sync/networkMode';
import { useTripStore } from './tripStore';

/** Every cache table loadTrip reads from, so one test can never see another's writes. */
async function clearCache(): Promise<void> {
  await Promise.all([
    offlineDb.trips.clear(),
    offlineDb.days.clear(),
    offlineDb.places.clear(),
    offlineDb.assignments.clear(),
    offlineDb.packingItems.clear(),
    offlineDb.todoItems.clear(),
    offlineDb.budgetItems.clear(),
    offlineDb.reservations.clear(),
    offlineDb.tripFiles.clear(),
    offlineDb.tags.clear(),
    offlineDb.categories.clear(),
  ]);
}

beforeEach(async () => {
  resetAllStores();
  server.resetHandlers();
  await clearCache();
  await upsertTrip(buildTrip({ id: 1, title: 'Paris' }));
});

afterEach(() => {
  setForcedOffline(false);
  vi.restoreAllMocks();
});

/** Days as the day list endpoint returns them: with embedded assignments + notes. */
function serverDays() {
  const place = buildPlace({ id: 500, trip_id: 1 });
  return [
    buildDay({
      id: 1,
      trip_id: 1,
      day_number: 1,
      assignments: [buildAssignment({ id: 900, day_id: 1, place })],
      notes_items: [buildDayNote({ id: 800, day_id: 1, text: 'Pick up keys' })],
    }),
    // A day row that arrives without the embedded arrays at all.
    buildDay({ id: 2, trip_id: 1, day_number: 2, assignments: undefined, notes_items: undefined }),
  ];
}

async function seedLocalPlannerData(placeId = 500): Promise<void> {
  const days = serverDays()
  const place = buildPlace({ id: placeId, trip_id: 1 })
  await upsertDays(days)
  await upsertPlaces([place])
  const trip = await offlineDb.trips.get(1)
  const day = await offlineDb.days.get(1)
  const storedPlace = await offlineDb.places.get(placeId)
  await offlineDb.assignments.put({
    id: 900,
    sync_id: randomId(),
    trip_id: 1,
    trip_sync_id: trip!.sync_id!,
    day_id: 1,
    day_sync_id: day!.sync_id!,
    place_id: placeId,
    place_sync_id: storedPlace!.sync_id!,
    order_index: 0,
    notes: null,
    created_at: '2025-01-01T00:00:00.000Z',
    updated_at: '2025-01-01T00:00:00.000Z',
    deleted_at: null,
  })
}

describe('tripStore', () => {
  describe('selectors and filters', () => {
    it('FE-TSTORE-001: setSelectedDay, setPlacesFilter and setPlacesCategoryFilter write through', () => {
      useTripStore.getState().setSelectedDay(42);
      useTripStore.getState().setPlacesFilter('unplanned');
      useTripStore.getState().setPlacesCategoryFilter(new Set(['3', '7']));

      const state = useTripStore.getState();
      expect(state.selectedDayId).toBe(42);
      expect(state.placesFilter).toBe('unplanned');
      expect([...state.placesCategoryFilter]).toEqual(['3', '7']);

      useTripStore.getState().setSelectedDay(null);
      expect(useTripStore.getState().selectedDayId).toBeNull();
    });
  });

  describe('resetTrip', () => {
    it('FE-TSTORE-002: clears every trip-scoped slice but keeps the global tags and categories', () => {
      seedStore(useTripStore, {
        trip: buildTrip({ id: 1 }),
        days: [buildDay({ id: 1, trip_id: 1 })],
        places: [buildPlace({ trip_id: 1 })],
        assignments: { '1': [buildAssignment({ day_id: 1 })] },
        dayNotes: { '1': [buildDayNote({ day_id: 1 })] },
        packingItems: [buildPackingItem({ trip_id: 1 })],
        todoItems: [buildTodoItem({ trip_id: 1 })],
        budgetItems: [buildBudgetItem({ trip_id: 1 })],
        files: [buildTripFile({ trip_id: 1 })],
        reservations: [buildReservation({ trip_id: 1 })],
        tags: [buildTag({ id: 5 })],
        categories: [buildCategory({ id: 6 })],
        selectedDayId: 1,
        placesFilter: 'unplanned',
        placesCategoryFilter: new Set(['3']),
        error: 'stale error',
      });

      useTripStore.getState().resetTrip();

      const state = useTripStore.getState();
      expect(state.trip).toBeNull();
      expect(state.days).toEqual([]);
      expect(state.places).toEqual([]);
      expect(state.assignments).toEqual({});
      expect(state.dayNotes).toEqual({});
      expect(state.packingItems).toEqual([]);
      expect(state.todoItems).toEqual([]);
      expect(state.budgetItems).toEqual([]);
      expect(state.files).toEqual([]);
      expect(state.reservations).toEqual([]);
      expect(state.selectedDayId).toBeNull();
      expect(state.placesFilter).toBe('all');
      expect(state.placesCategoryFilter.size).toBe(0);
      expect(state.error).toBeNull();
      // Global lookups survive a trip switch.
      expect(state.tags.map(t => t.id)).toEqual([5]);
      expect(state.categories.map(c => c.id)).toEqual([6]);
    });
  });

  describe('loadTrip', () => {
    it('FE-TSTORE-003: fills every slice and builds the assignments/dayNotes maps', async () => {
      await seedLocalPlannerData()
      server.use(
        http.get('/api/trips/1', () => HttpResponse.json({ trip: buildTrip({ id: 1, title: 'Paris' }) })),
        http.get('/api/trips/1/packing', () => HttpResponse.json({ items: [buildPackingItem({ id: 60, trip_id: 1 })] })),
        http.get('/api/trips/1/todo', () => HttpResponse.json({ items: [buildTodoItem({ id: 70, trip_id: 1 })] })),
        http.get('/api/trips/1/budget', () => HttpResponse.json({ items: [buildBudgetItem({ id: 80, trip_id: 1 })] })),
        http.get('/api/trips/1/reservations', () => HttpResponse.json({ reservations: [buildReservation({ id: 90, trip_id: 1 })] })),
        http.get('/api/trips/1/files', () => HttpResponse.json({ files: [buildTripFile({ id: 95, trip_id: 1 })] })),
        http.get('/api/tags', () => HttpResponse.json({ tags: [buildTag({ id: 11 })] })),
        http.get('/api/categories', () => HttpResponse.json({ categories: [buildCategory({ id: 12 })] })),
      );

      await useTripStore.getState().loadTrip(1);

      const state = useTripStore.getState();
      expect(state.trip?.title).toBe('Paris');
      expect(state.days.map(d => d.id)).toEqual([1, 2]);
      expect(state.places.map(p => p.id)).toEqual([500]);
      expect(state.packingItems.map(i => i.id)).toEqual([60]);
      expect(state.todoItems.map(i => i.id)).toEqual([70]);
      expect(state.budgetItems.map(i => i.id)).toEqual([80]);
      expect(state.reservations.map(r => r.id)).toEqual([90]);
      expect(state.files.map(f => f.id)).toEqual([95]);
      expect(state.tags.map(t => t.id)).toEqual([11]);
      expect(state.categories.map(c => c.id)).toEqual([12]);
      expect(state.assignments['1'].map(a => a.id)).toEqual([900]);
      expect(state.dayNotes['1'].map(n => n.id)).toEqual([800]);
      // A day row without the embedded arrays still gets an entry.
      expect(state.assignments['2']).toEqual([]);
      expect(state.dayNotes['2']).toEqual([]);
      expect(state.isLoading).toBe(false);
      expect(state.error).toBeNull();
    });

    it('FE-TSTORE-004: drops the previously loaded trip before fetching the next one', async () => {
      seedStore(useTripStore, {
        trip: buildTrip({ id: 9, title: 'Old trip' }),
        places: [buildPlace({ id: 111, trip_id: 9 })],
      });

      let placesDuringLoad: number[] = [];
      server.use(
        http.get('/api/trips/1', () => {
          placesDuringLoad = useTripStore.getState().places.map(p => p.id);
          return HttpResponse.json({ trip: buildTrip({ id: 1 }) });
        }),
        http.get('/api/trips/1/days', () => HttpResponse.json({ days: [] })),
        http.get('/api/trips/1/places', () => HttpResponse.json({ places: [] })),
      );

      await useTripStore.getState().loadTrip(1);

      expect(placesDuringLoad).toEqual([]);
      expect(useTripStore.getState().trip?.id).toBe(1);
    });

    it('FE-TSTORE-005: a failing budget/reservations/files fetch is non-fatal', async () => {
      server.use(
        http.get('/api/trips/1/days', () => HttpResponse.json({ days: [] })),
        http.get('/api/trips/1/budget', () => HttpResponse.json({ error: 'nope' }, { status: 500 })),
        http.get('/api/trips/1/reservations', () => HttpResponse.json({ error: 'nope' }, { status: 500 })),
        http.get('/api/trips/1/files', () => HttpResponse.json({ error: 'nope' }, { status: 500 })),
      );

      await useTripStore.getState().loadTrip(1);

      const state = useTripStore.getState();
      expect(state.trip?.id).toBe(1);
      expect(state.budgetItems).toEqual([]);
      expect(state.reservations).toEqual([]);
      expect(state.files).toEqual([]);
      expect(state.error).toBeNull();
    });

    it('FE-TSTORE-006: falls back to the cached tags and categories when their endpoints fail', async () => {
      await offlineDb.tags.put(buildTag({ id: 31, name: 'Cached tag' }));
      await offlineDb.categories.put(buildCategory({ id: 32, name: 'Cached category' }));

      server.use(
        http.get('/api/trips/1/days', () => HttpResponse.json({ days: [] })),
        http.get('/api/tags', () => HttpResponse.json({ error: 'offline' }, { status: 502 })),
        http.get('/api/categories', () => HttpResponse.json({ error: 'offline' }, { status: 502 })),
      );

      await useTripStore.getState().loadTrip(1);

      expect(useTripStore.getState().tags.map(t => t.name)).toEqual(['Cached tag']);
      expect(useTripStore.getState().categories.map(c => c.name)).toEqual(['Cached category']);
    });

    it('FE-TSTORE-020: serves the whole trip from the offline cache when the app is forced offline', async () => {
      await offlineDb.trips.put(buildTrip({ id: 1, title: 'Cached trip' }));
      await offlineDb.days.bulkPut([buildDay({ id: 1, trip_id: 1, day_number: 1 })]);
      await offlineDb.places.bulkPut([buildPlace({ id: 502, trip_id: 1 })]);
      await offlineDb.packingItems.bulkPut([buildPackingItem({ id: 62, trip_id: 1 })]);
      await offlineDb.todoItems.bulkPut([buildTodoItem({ id: 73, trip_id: 1 })]);
      await offlineDb.budgetItems.bulkPut([buildBudgetItem({ id: 82, trip_id: 1 })]);
      await offlineDb.reservations.bulkPut([buildReservation({ id: 93, trip_id: 1 })]);
      await offlineDb.tripFiles.bulkPut([buildTripFile({ id: 97, trip_id: 1 })]);
      await offlineDb.tags.put(buildTag({ id: 41, name: 'Offline tag' }));
      await offlineDb.categories.put(buildCategory({ id: 42, name: 'Offline category' }));

      // Any request reaching the network would mean the offline gate leaked.
      const leaked: string[] = [];
      server.use(
        http.get('/api/*', ({ request }) => {
          leaked.push(new URL(request.url).pathname);
          return HttpResponse.json({}, { status: 500 });
        }),
      );
      setForcedOffline(true);

      await useTripStore.getState().loadTrip(1);

      expect(leaked).toEqual([]);
      const state = useTripStore.getState();
      expect(state.trip?.title).toBe('Cached trip');
      expect(state.days.map(d => d.id)).toEqual([1]);
      expect(state.places.map(p => p.id)).toEqual([502]);
      expect(state.packingItems.map(i => i.id)).toEqual([62]);
      expect(state.todoItems.map(i => i.id)).toEqual([73]);
      expect(state.budgetItems.map(i => i.id)).toEqual([82]);
      expect(state.reservations.map(r => r.id)).toEqual([93]);
      expect(state.files.map(f => f.id)).toEqual([97]);
      expect(state.tags.map(t => t.name)).toEqual(['Offline tag']);
      expect(state.categories.map(c => c.name)).toEqual(['Offline category']);
      expect(state.isLoading).toBe(false);
    });

  it('FE-TSTORE-021: reports a cache miss as an error when forced offline', async () => {
      await offlineDb.trips.clear();
      setForcedOffline(true);

      await expect(useTripStore.getState().loadTrip(1)).rejects.toThrow();
      expect(useTripStore.getState().error).toBe('Trip not found in local database');
      expect(useTripStore.getState().isLoading).toBe(false);
    });

  it('FE-TSTORE-007: sets the error state and rethrows when the trip itself cannot be fetched', async () => {
      await offlineDb.trips.clear();
      server.use(
        http.get('/api/trips/1', () => HttpResponse.json({ error: 'Forbidden' }, { status: 403 })),
        http.get('/api/trips/1/days', () => HttpResponse.json({ days: [] })),
      );

      await expect(useTripStore.getState().loadTrip(1)).rejects.toThrow();

      const state = useTripStore.getState();
      expect(state.isLoading).toBe(false);
      expect(state.error).toBe('Trip not found in local database');
      expect(state.trip).toBeNull();
    });
  });

  describe('hydrateActiveTrip', () => {
    it('FE-TSTORE-008: silently re-pulls every collaborative slice and nudges the planner', async () => {
      await seedLocalPlannerData(501)
      seedStore(useTripStore, { trip: buildTrip({ id: 1 }), places: [], days: [] });

      server.use(
        http.get('/api/trips/1/packing', () => HttpResponse.json({ items: [buildPackingItem({ id: 61, trip_id: 1 })] })),
        http.get('/api/trips/1/todo', () => HttpResponse.json({ items: [buildTodoItem({ id: 71, trip_id: 1 })] })),
        http.get('/api/trips/1/budget', () => HttpResponse.json({ items: [buildBudgetItem({ id: 81, trip_id: 1 })] })),
        http.get('/api/trips/1/reservations', () => HttpResponse.json({ reservations: [buildReservation({ id: 91, trip_id: 1 })] })),
        http.get('/api/trips/1/files', () => HttpResponse.json({ files: [buildTripFile({ id: 96, trip_id: 1 })] })),
      );

      const nudged = vi.fn();
      window.addEventListener('accommodations:refresh', nudged);
      await useTripStore.getState().hydrateActiveTrip(1);
      window.removeEventListener('accommodations:refresh', nudged);

      const state = useTripStore.getState();
      expect(state.trip?.title).toBe('Paris');
      expect(state.days.map(d => d.id)).toEqual([1, 2]);
      expect(state.places.map(p => p.id)).toEqual([501]);
      expect(state.packingItems.map(i => i.id)).toEqual([61]);
      expect(state.todoItems.map(i => i.id)).toEqual([71]);
      expect(state.budgetItems.map(i => i.id)).toEqual([81]);
      expect(state.reservations.map(r => r.id)).toEqual([91]);
      expect(state.files.map(f => f.id)).toEqual([96]);
      // The trip refreshes without a splash or resetTrip.
      expect(state.isLoading).toBe(false);
      expect(nudged).toHaveBeenCalledTimes(1);
    });

    it('FE-TSTORE-008b: exposes categories pulled into IndexedDB without reloading the page', async () => {
      const syncedCategory = buildCategory({ id: -7, name: 'Museum' })
      await offlineDb.categories.put({
        ...syncedCategory,
        sync_id: randomId(),
        created_at: '2025-01-01T00:00:00.000Z',
        updated_at: '2025-01-01T00:00:00.000Z',
        deleted_at: null,
      })
      seedStore(useTripStore, { trip: buildTrip({ id: 1 }), categories: [] })

      await useTripStore.getState().hydrateActiveTrip(1)

      expect(useTripStore.getState().categories.map(c => c.name)).toEqual(['Museum'])
    })

    it('FE-TSTORE-009: one failing resource does not wipe the others', async () => {
      const stalePlace = buildPlace({ id: 111, trip_id: 1, name: 'Kept' });
      await upsertPlaces([stalePlace])
      seedStore(useTripStore, { places: [stalePlace], packingItems: [], todoItems: [] });
      vi.spyOn(console, 'error').mockImplementation(() => {});

      server.use(
        http.get('/api/trips/1/packing', () => HttpResponse.json({ error: 'nope' }, { status: 500 })),
        http.get('/api/trips/1/todo', () => HttpResponse.json({ items: [buildTodoItem({ id: 72, trip_id: 1 })] })),
      );

      await expect(useTripStore.getState().hydrateActiveTrip(1)).resolves.toBeUndefined();

      expect(useTripStore.getState().places.map(p => p.name)).toEqual(['Kept']);
      expect(useTripStore.getState().todoItems.map(i => i.id)).toEqual([72]);
    });
  });

  describe('refreshDays', () => {
    it('FE-TSTORE-010: rebuilds the days list plus the assignments and notes maps', async () => {
      await seedLocalPlannerData()
      seedStore(useTripStore, { days: [], assignments: { '99': [] }, dayNotes: { '99': [] } });

      await useTripStore.getState().refreshDays(1);

      const state = useTripStore.getState();
      expect(state.days.map(d => d.id)).toEqual([1, 2]);
      expect(state.assignments['1'].map(a => a.id)).toEqual([900]);
      expect(state.dayNotes['1'].map(n => n.id)).toEqual([800]);
      // The maps are rebuilt from scratch, so a stale day key is gone.
      expect(state.assignments['99']).toBeUndefined();
    });

    it('FE-TSTORE-011: refreshes Days from IndexedDB without a Server request', async () => {
      await upsertDays([buildDay({ id: 1, trip_id: 1 })])
      seedStore(useTripStore, { days: [] });
      const fetchSpy = vi.spyOn(globalThis, 'fetch')
      await useTripStore.getState().refreshDays(1)
      expect(useTripStore.getState().days.map(d => d.id)).toEqual([1])
      expect(fetchSpy).not.toHaveBeenCalled()
    });
  });

  describe('updateTrip', () => {
    it('FE-TSTORE-012: persists the patch locally and updates the store', async () => {
      seedStore(useTripStore, { trip: buildTrip({ id: 1, title: 'Old' }), days: [], reservations: [] });

      const result = await useTripStore.getState().updateTrip(1, { title: 'New', start_date: '2025-06-01' });

      expect(result.title).toBe('New');
      expect(useTripStore.getState().trip?.title).toBe('New');
      expect((await offlineDb.trips.get(1))?.title).toBe('New');
      expect(useTripStore.getState().days).toEqual([]);
      expect(useTripStore.getState().reservations).toEqual([]);
    });

    it('FE-TSTORE-013: ignores the server-only date shift hint while persisting dates', async () => {
      await useTripStore.getState().updateTrip(1, { start_date: '2025-07-01', date_shift_mode: 'shift_all' });

      expect((await offlineDb.trips.get(1))?.start_date).toBe('2025-07-01');
    });

    it('FE-TSTORE-014: reports a missing local row and leaves the store untouched', async () => {
      const trip = buildTrip({ id: 1, title: 'Old' });
      seedStore(useTripStore, { trip });
      await offlineDb.trips.delete(1);

      await expect(useTripStore.getState().updateTrip(1, { title: 'New' })).rejects.toThrow('Trip not found in local database');
      expect(useTripStore.getState().trip?.title).toBe('Old');
    });
  });

  describe('addTag', () => {
    it('FE-TSTORE-015: appends the created tag to the global list', async () => {
      seedStore(useTripStore, { tags: [buildTag({ id: 1, name: 'Existing' })] });
      server.use(
        http.post('/api/tags', () => HttpResponse.json({ tag: buildTag({ id: 2, name: 'Food', color: '#00ff00' }) })),
      );

      const created = await useTripStore.getState().addTag({ name: 'Food', color: '#00ff00' });

      expect(created.id).toBe(2);
      expect(useTripStore.getState().tags.map(t => t.name)).toEqual(['Existing', 'Food']);
    });

    it('FE-TSTORE-016: throws the server message and keeps the list unchanged', async () => {
      seedStore(useTripStore, { tags: [buildTag({ id: 1 })] });
      server.use(
        http.post('/api/tags', () => HttpResponse.json({ error: 'Tag exists' }, { status: 409 })),
      );

      await expect(useTripStore.getState().addTag({ name: 'Food' })).rejects.toThrow('Tag exists');
      expect(useTripStore.getState().tags).toHaveLength(1);
    });
  });

  describe('addCategory', () => {
    it('FE-TSTORE-017: appends the created category to the global list', async () => {
      seedStore(useTripStore, { categories: [buildCategory({ id: 1, name: 'Existing' })] });
      server.use(
        http.post('/api/categories', () =>
          HttpResponse.json({ category: buildCategory({ id: 2, name: 'Museums', icon: 'landmark' }) }),
        ),
      );

      const created = await useTripStore.getState().addCategory({ name: 'Museums', icon: 'landmark' });

      expect(created.icon).toBe('landmark');
      expect(useTripStore.getState().categories.map(c => c.name)).toEqual(['Existing', 'Museums']);
    });

    it('FE-TSTORE-018: throws the server message and keeps the list unchanged', async () => {
      seedStore(useTripStore, { categories: [buildCategory({ id: 1 })] });
      server.use(
        http.post('/api/categories', () => HttpResponse.json({ error: 'Category exists' }, { status: 409 })),
      );

      await expect(useTripStore.getState().addCategory({ name: 'Museums' })).rejects.toThrow('Category exists');
      expect(useTripStore.getState().categories).toHaveLength(1);
    });
  });

  describe('handleRemoteEvent', () => {
    it('FE-TSTORE-019: routes a socket event into the store', () => {
      const place = buildPlace({ id: 500, trip_id: 1, name: 'Before' });
      seedStore(useTripStore, { places: [place] });

      useTripStore.getState().handleRemoteEvent({
        type: 'place:updated',
        place: { ...place, name: 'After' },
      });

      expect(useTripStore.getState().places[0].name).toBe('After');
    });

    it('FE-TSTORE-019b: asks the planner to reload accommodations when a place image changes', () => {
      // Accommodation cards keep their own copy of the place, so a new hero
      // image would otherwise only show up after a reload.
      const place = buildPlace({ id: 500, trip_id: 1, image_url: null });
      seedStore(useTripStore, { places: [place] });
      const listener = vi.fn();
      window.addEventListener('accommodations:refresh', listener);

      useTripStore.getState().handleRemoteEvent({
        type: 'place:updated',
        place: { ...place, image_url: '/api/maps/place-photo/way%3A1~p0/bytes' },
      });

      expect(listener).toHaveBeenCalledTimes(1);
      window.removeEventListener('accommodations:refresh', listener);
    });

    it('FE-TSTORE-019c: does not reload accommodations for an edit that leaves the image alone', () => {
      const place = buildPlace({ id: 500, trip_id: 1, name: 'Before', image_url: '/uploads/places/a.jpg' });
      seedStore(useTripStore, { places: [place] });
      const listener = vi.fn();
      window.addEventListener('accommodations:refresh', listener);

      useTripStore.getState().handleRemoteEvent({
        type: 'place:updated',
        place: { ...place, name: 'After' },
      });

      expect(listener).not.toHaveBeenCalled();
      window.removeEventListener('accommodations:refresh', listener);
    });
  });
});

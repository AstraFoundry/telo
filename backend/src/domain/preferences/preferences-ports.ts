import type { UserPreferences } from "./user-preferences";

export interface UserPreferencesRepository {
  get(): Promise<UserPreferences>;
  save(preferences: UserPreferences): Promise<void>;
}

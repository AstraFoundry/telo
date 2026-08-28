import type {
  UpdateUserPreferencesInput,
  UserPreferencesDto,
} from "../../../../contracts/src/ipc";
import type { UserPreferencesRepository } from "../../domain/preferences/preferences-ports";

export class UpdateUserPreferencesService {
  constructor(private readonly repository: UserPreferencesRepository) {}

  async get(): Promise<UserPreferencesDto> {
    return (await this.repository.get()).snapshot();
  }

  async execute(
    input: UpdateUserPreferencesInput,
  ): Promise<UserPreferencesDto> {
    const preferences = (await this.repository.get()).update(input);
    await this.repository.save(preferences);
    return preferences.snapshot();
  }
}

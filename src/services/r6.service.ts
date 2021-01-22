const R6API = require('r6api.js');

import { CacheService } from './cache.service';
import { Database, R6Collection } from '../databases/database';

import { PlayerLevel } from '../models/player-level';
import { PlayerPlaytime } from '../models/player-playtime';
import { PlayerRank } from '../models/player-rank';
import { PlayerStats } from '../models/player-stats';
import { PlayerUsername } from '../models/player-username';
import { ServerStatus } from '../models/server-status';
import { PlayerDoc } from '../models/player-doc';

export interface R6ServiceOptions {
  caching?: boolean,
  expiration?: number,
  cacheService?: CacheService,
  database?: Database
}

export class R6Service {

  private caching = false;
  private expiration = 60 * 1000; // 1 minute
  private cacheService: CacheService;
  private database: Database;
  private readonly r6Api: any;

  constructor(
    private readonly email: String,
    private readonly password: String,
    private readonly options?: R6ServiceOptions
  ) {
    this.setOptions();
    this.r6Api = new R6API(this.email, this.password);
  }

  private setOptions() {
    if(this.options.caching != null) {
      this.caching = this.options.caching;
    }

    if(this.options.expiration != null) {
      this.expiration = this.options.expiration;
    }

    if(this.options.cacheService != null) {
      this.cacheService = this.options.cacheService;
    }

    if(this.options.database != null) {
      this.database = this.options.database;
    }
  }

  private async getCachedData(id: string, collection: R6Collection,
    getData: () => Promise<any | null>): Promise<any | null> {

    if (this.caching || !this.cacheService.isOnline() ||
      !this.database.isOnline()) {
      return await getData();
    }
    
    // create a cache id for each collection of each player
    const cacheId = `${id}_${collection}`;
    const now = new Date().getTime();
    let cachedTimestamp = await this.cacheService.getExpiration(cacheId) ?? -1;

    const notExpired = cachedTimestamp + this.expiration > now;

    if (notExpired) {
      const result = await this.database.get(collection, id);
      if (result != null) {
        return result;
      }
      cachedTimestamp = -1;
    }

    // caching if data is expired or not in the database
    let data = await getData();
    if (cachedTimestamp == -1) {
      await this.database.insert(collection, data);
    } else {
      await this.database.update(collection, id, data);
    }
    await this.cacheService.setExpiration(id, now);
    return data;
  }

  private async getFirstResult<T>(getData: () => Promise<any | null>): Promise<T> {
    const result = await getData();
    return result.length > 0 ? result[0] : null;
  }

  async getId(platform: string, username: string): Promise<string> {
    const getId = (): Promise<string> => this.r6Api.getId(platform, username).then(el => el[0].id);
    if (this.caching || !this.cacheService.isOnline()) {
      return await getId();
    }

    const platformUsername = `${platform}/${username}`;
    const cachedId = await this.cacheService.getId(platformUsername);
    if (cachedId != null) {
      return cachedId;
    }
    const id = await getId();
    await this.cacheService.setId(platformUsername, id);
    return id;
  }


  async getLevelById(platform: string, id: string): Promise<PlayerLevel | null> {
    return await this.getCachedData(id, R6Collection.level, async () => {
      return this.getFirstResult(() => this.r6Api.getLevel(platform, id));
    });
  }

  async getLevelByUsername(platform: string, username: string): Promise<PlayerLevel | null> {
    const id = await this.getId(platform, username);
    return await this.getLevelById(platform, id);
  }

  async getPlaytimeById(platform: string, id: string): Promise<PlayerPlaytime | null> {
    return await this.getCachedData(id, R6Collection.playtime, async () => {
      return this.getFirstResult(() => this.r6Api.getPlaytime(platform, id));
    });
  }

  async getPlaytimeByUsername(platform: string, username: string): Promise<PlayerPlaytime | null> {
    const id = await this.getId(platform, username);
    return await this.getPlaytimeById(platform, id);
  }

  async getRankById(platform: string, id: string): Promise<PlayerRank | null> {
    return await this.getCachedData(id, R6Collection.rank, async () => {
      return this.getFirstResult(() => this.r6Api.getRank(platform, id, {
        seasons: 'all',
        regions: ['emea']
      }));
    });
  }

  async getRankByUsername(platform: string, username: string): Promise<PlayerRank | null> {
    const id = await this.getId(platform, username);
    return await this.getRankById(platform, id);
  }

  async getStatsById(platform: string, id: string): Promise<PlayerStats> {
    return await this.getCachedData(id, R6Collection.stats, async () => {
      return this.r6Api.getStats(platform, id).then(el => el[0])
    });
  }

  async getStatsByUsername(platform: string, username: string): Promise<PlayerStats> {
    const id = await this.getId(platform, username);
    return await this.getStatsById(platform, id);
  }

  async getServersStatus(): Promise<ServerStatus> {
    return await this.r6Api.getStatus();
  }

  async getUsername(platform: string, id: string): Promise<PlayerUsername | null> {
    return await this.getCachedData(id, R6Collection.username, async () => {
      return this.getFirstResult(() => this.r6Api.getUsername(platform, id));
    });
  }

  async getAll(platform: string, username: string): Promise<PlayerDoc> {
    const id = await this.getId(platform, username);

    const result = await Promise.all([
      this.getLevelById(platform, id),
      this.getPlaytimeById(platform, id),
      this.getRankById(platform, id),
      this.getStatsById(platform, id),
      this.getUsername(platform, id)
    ]);

    return {
      player: username,
      level: result[0],
      playtime: result[1],
      rank: result[2],
      stats: result[3],
      username: result[4]
    }
  }
}

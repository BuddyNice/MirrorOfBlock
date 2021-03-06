namespace TwitterAPI {
  const { validateTwitterUserName } = MirrorBlock.Utils
  export class APIError extends Error {
    constructor(public readonly response: APIResponse) {
      super('API Error!')
      // from: https://www.typescriptlang.org/docs/handbook/release-notes/typescript-2-2.html#support-for-newtarget
      Object.setPrototypeOf(this, new.target.prototype)
    }
  }

  async function sendRequest(
    method: HTTPMethods,
    path: string,
    paramsObj: URLParamsObj = {}
  ): Promise<APIResponse> {
    const { response } = await browser.runtime.sendMessage<
      MBRequestAPIMessage,
      MBResponseAPIMessage
    >({
      action: Action.RequestAPI,
      method,
      path,
      paramsObj,
    })
    console.debug('response: ', response)
    return response
  }
  export async function blockUser(user: TwitterUser): Promise<boolean> {
    if (user.blocking) {
      return true
    }
    const shouldNotBlock =
      user.following ||
      user.followed_by ||
      user.follow_request_sent ||
      !user.blocked_by
    if (shouldNotBlock) {
      const fatalErrorMessage = `!!!!!FATAL!!!!!:
attempted to block user that should NOT block!!
(user: ${user.screen_name})`
      console.error(fatalErrorMessage)
      throw new Error(fatalErrorMessage)
    }
    return blockUserById(user.id_str)
  }

  export async function blockUserById(userId: string): Promise<boolean> {
    const response = await sendRequest('post', '/blocks/create.json', {
      user_id: userId,
      include_entities: false,
      skip_status: true,
    })
    return response.ok
  }

  async function getFollowingsList(
    user: TwitterUser,
    cursor: string = '-1'
  ): Promise<FollowsListResponse> {
    const response = await sendRequest('get', '/friends/list.json', {
      user_id: user.id_str,
      count: 200,
      skip_status: true,
      include_user_entities: false,
      cursor,
    })
    if (response.ok) {
      return response.body as FollowsListResponse
    } else {
      throw new APIError(response)
    }
  }
  async function getFollowersList(
    user: TwitterUser,
    cursor: string = '-1'
  ): Promise<FollowsListResponse> {
    const response = await sendRequest('get', '/followers/list.json', {
      user_id: user.id_str,
      // screen_name: userName,
      count: 200,
      skip_status: true,
      include_user_entities: false,
      cursor,
    })
    if (response.ok) {
      return response.body as FollowsListResponse
    } else {
      throw new APIError(response)
    }
  }

  export async function* getAllFollows(
    user: TwitterUser,
    followType: FollowType,
    options: FollowsScraperOptions
  ): AsyncIterableIterator<Either<APIError, Readonly<TwitterUser>>> {
    let cursor = '-1'
    while (true) {
      try {
        let json: FollowsListResponse
        switch (followType) {
          case FollowType.followers:
            json = await getFollowersList(user, cursor)
            break
          case FollowType.following:
            json = await getFollowingsList(user, cursor)
            break
          default:
            throw new Error('unreachable')
        }
        cursor = json.next_cursor_str
        const users = json.users as TwitterUser[]
        yield* users.map(user =>
          Object.freeze({
            ok: true as const,
            value: user,
          })
        )
        if (cursor === '0') {
          break
        } else {
          await MirrorBlock.Utils.sleep(options.delay)
          continue
        }
      } catch (error) {
        if (error instanceof APIError) {
          yield {
            ok: false,
            error,
          }
        } else {
          throw error
        }
      }
    }
  }

  export async function getSingleUserById(
    userId: string
  ): Promise<TwitterUser> {
    const response = await sendRequest('get', '/users/show.json', {
      user_id: userId,
      skip_status: true,
      include_entities: false,
    })
    if (response.ok) {
      return response.body as TwitterUser
    } else {
      throw new APIError(response)
    }
  }

  export async function getSingleUserByName(
    userName: string
  ): Promise<TwitterUser> {
    const isValidUserName = validateTwitterUserName(userName)
    if (!isValidUserName) {
      throw new Error(`Invalid user name "${userName}"!`)
    }
    const response = await sendRequest('get', '/users/show.json', {
      // user_id: user.id_str,
      screen_name: userName,
      skip_status: true,
      include_entities: false,
    })
    if (response.ok) {
      return response.body as TwitterUser
    } else {
      throw new APIError(response)
    }
  }

  export async function getMultipleUsersById(
    userIds: string[]
  ): Promise<TwitterUser[]> {
    if (userIds.length === 0) {
      return []
    }
    if (userIds.length > 100) {
      throw new Error('too many users! (> 100)')
    }
    const joinedIds = Array.from(new Set(userIds)).join(',')
    const response = await sendRequest('post', '/users/lookup.json', {
      user_id: joinedIds,
      include_entities: false,
      // screen_name: ...
    })
    if (response.ok) {
      return response.body as TwitterUser[]
    } else {
      throw new APIError(response)
    }
  }

  export async function getFriendships(
    users: TwitterUser[]
  ): Promise<FriendshipResponse> {
    const userIds = users.map(user => user.id_str)
    if (userIds.length === 0) {
      return []
    }
    if (userIds.length > 100) {
      throw new Error('too many users! (> 100)')
    }
    const joinedIds = Array.from(new Set(userIds)).join(',')
    const response = await sendRequest('get', '/friendships/lookup.json', {
      user_id: joinedIds,
    })
    if (response.ok) {
      return response.body as FriendshipResponse
    } else {
      throw new Error('response is not ok')
    }
  }

  export async function getRelationship(
    sourceUser: TwitterUser,
    targetUser: TwitterUser
  ): Promise<Relationship> {
    const source_id = sourceUser.id_str
    const target_id = targetUser.id_str
    const response = await sendRequest('get', '/friendships/show.json', {
      source_id,
      target_id,
    })
    if (response.ok) {
      const { relationship } = (await response.body) as {
        relationship: Relationship
      }
      return relationship
    } else {
      throw new Error('response is not ok')
    }
  }

  export async function getMyself(): Promise<TwitterUser> {
    const response = await sendRequest(
      'get',
      '/account/verify_credentials.json'
    )
    if (response.ok) {
      return response.body as TwitterUser
    } else {
      throw new APIError(response)
    }
  }

  export async function getRateLimitStatus(): Promise<LimitStatus> {
    const response = await sendRequest(
      'get',
      '/application/rate_limit_status.json'
    )
    const { resources } = response.body as {
      resources: LimitStatus
    }
    return resources
  }

  export async function getFollowsScraperRateLimitStatus(
    followType: FollowType
  ): Promise<Limit> {
    const limitStatus = await TwitterAPI.getRateLimitStatus()
    if (followType === FollowType.followers) {
      return limitStatus.followers['/followers/list']
    } else if (followType === FollowType.following) {
      return limitStatus.friends['/friends/list']
    } else {
      throw new Error('unreachable')
    }
  }
}

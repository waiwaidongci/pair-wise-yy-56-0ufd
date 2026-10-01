import { inject, Injectable } from '@angular/core'
import { Apollo, gql } from 'apollo-angular'
import { map } from 'rxjs'
import type { InspectionPlan, ReviewItem, Weld } from '../types'
import { WELDS_QUERY } from '../store/queries'

@Injectable({ providedIn: 'root' })
export class WeldGraphqlService {
  private readonly apollo = inject(Apollo)
  load() {
    return this.apollo.watchQuery<{ welds: Weld[]; plans: InspectionPlan[]; reviews: ReviewItem[] }>({
      query: gql(WELDS_QUERY),
      fetchPolicy: 'cache-first',
    }).valueChanges.pipe(map((result) => result.data))
  }
}

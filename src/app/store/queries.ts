const REVIEWS = `reviews { id kind target summary detail state time relatedPlanIds relatedDefectId requestId }`

export const WELDS_QUERY = `#graphql
  query Welds {
    welds {
      id drawing component joint method welder qualification qualificationValid
      inspectionRatio requiredRatio status x y
      defects {
        id position type length level method report gate
        repairs { id seq position method result operator time requestId }
        reinspections { id method result inspector time report requestId }
        conflicts { requestId inspector time payload { type level length method report } }
      }
    }
    plans { id date method weldIds inspector state revision recalcReason removedWeldIds }
    ${REVIEWS}
  }
`

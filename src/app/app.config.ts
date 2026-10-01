import { ApplicationConfig } from '@angular/core'
import { provideRouter } from '@angular/router'
import { provideStore } from '@ngrx/store'
import { providePrimeNG } from 'primeng/config'
import Aura from '@primeng/themes/aura'
import { provideApollo } from 'apollo-angular'
import { ApolloLink, InMemoryCache, Observable } from '@apollo/client/core'
import { routes } from './app.routes'
import { weldReducer } from './store/weld.reducer'
import { WELDS_QUERY } from './store/queries'

const mockGraphqlLink = new ApolloLink((operation) => new Observable((observer) => {
  setTimeout(() => {
    observer.next({ data: operation.operationName === 'Welds' ? mockData : {} })
    observer.complete()
  }, 180)
}))

const mockData = {
  welds: [
    { id:'W-101', drawing:'SG-04-钢柱', component:'KZ-12 / 柱翼缘', joint:'全熔透坡口焊', method:'GMAW', welder:'王凯', qualification:'GB/T 9448 · 2027-06', qualificationValid:true, inspectionRatio:100, requiredRatio:100, status:'合格', x:18, y:24, defects:[] },
    {
      id:'W-104', drawing:'SG-07-屋面梁', component:'GL-21 / 下翼缘', joint:'对接焊缝', method:'SAW', welder:'刘强',
      qualification:'GB/T 9448 · 2028-03', qualificationValid:true, inspectionRatio:100, requiredRatio:100, status:'待复检', x:48, y:38,
      defects:[{
        id:'D-31', position:42, type:'夹渣', length:12, level:'Ⅱ级', method:'UT', report:'UT-2026-0918', gate:'待复检',
        repairs:[
          { id:'RP-1', seq:1, position:42, method:'碳弧气刨清根 + SAW 补焊', result:'待复检', operator:'刘强', time:'09-20 11:02', requestId:'REQ-9181' },
          { id:'RP-2', seq:2, position:42, method:'打磨清根 + GTAW 补焊', result:'待复检', operator:'刘强', time:'09-28 15:40', requestId:'REQ-9204' },
        ],
        reinspections:[
          { id:'RI-1', method:'UT', result:'不合格', inspector:'赵岚', time:'09-24 10:18', report:'UT-2026-0924 同一位置仍见反射信号', requestId:'REQ-9211' },
        ],
        conflicts:[],
      }],
    },
    {
      id:'W-107', drawing:'SG-07-屋面梁', component:'GL-21 / 腹板', joint:'角焊缝', method:'FCAW', welder:'赵明',
      qualification:'GB/T 9448 · 2027-01', qualificationValid:true, inspectionRatio:20, requiredRatio:20, status:'返修中', x:61, y:42,
      defects:[{
        id:'D-32', position:68, type:'未熔合', length:18, level:'Ⅲ级', method:'MT', report:'MT-2026-0921', gate:'待返修',
        repairs:[
          { id:'RP-3', seq:1, position:68, method:'碳弧气刨 + FCAW 补焊', result:'不合格', operator:'赵明', time:'09-26 09:30', requestId:'REQ-9230' },
        ],
        reinspections:[],
        conflicts:[],
      }],
    },
    { id:'W-109', drawing:'SG-12-平台梁', component:'PL-08 / 节点板', joint:'角焊缝', method:'SMAW', welder:'孙鹏', qualification:'GB/T 9448 · 2026-10-01', qualificationValid:false, inspectionRatio:10, requiredRatio:20, status:'待检测', x:78, y:60, defects:[] },
    { id:'W-112', drawing:'SG-12-平台梁', component:'PL-08 / 腹板', joint:'组合焊缝', method:'GMAW', welder:'王凯', qualification:'GB/T 9448 · 2027-06', qualificationValid:true, inspectionRatio:50, requiredRatio:50, status:'已关闭', x:36, y:68, defects:[] },
  ],
  plans: [
    // W-109（孙鹏，资质失效）已在重算中剔除，计划升修订号、退回复核
    { id:'IP-2026-0930-A', date:'2026-09-30', method:'UT + MT', weldIds:['W-105','W-106','W-108'], removedWeldIds:['W-109'], inspector:'陈锋', state:'待复核', revision:2, recalcReason:'焊工 孙鹏 资质失效；原计划焊缝 W-105、W-106、W-108、W-109' },
    { id:'IP-2026-0929-B', date:'2026-09-29', method:'UT', weldIds:['W-104'], inspector:'赵岚', state:'执行中', revision:1 },
  ],
  reviews: [
    {
      id:'RV-0930-1', kind:'资质失效', target:'W-109', state:'待复核', time:'09-30 09:05',
      summary:'焊工孙鹏资质 2026-10-01 失效，计划 IP-2026-0930-A 已重算退回',
      detail:'W-109 已从计划剔除（修订号升至 2），须更换持证焊工并补足 20% 检测比例后方可重新排产。',
      relatedPlanIds:['IP-2026-0930-A'], relatedDefectId:null, requestId:null,
    },
  ],
}

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes),
    provideStore({ welds: weldReducer }),
    providePrimeNG({ theme: { preset: Aura, options: { darkModeSelector: false } } }),
    provideApollo(() => ({ cache: new InMemoryCache(), link: mockGraphqlLink })),
  ],
}

export { WELDS_QUERY }

import { planMission } from 'lib/mission-plan.js';
import { validateMissionGraph } from 'lib/mission-coordinator.js';

const cases = [
  {
    name:'research_with_multiple_dimensions',
    objective:'Research the market demand, costs, regulations and risks of opening a small solar installation business.',
    check:p=>p.steps.length>=3&&p.steps.every(s=>s.type==='research_search')&&p.acceptanceChecks.some(x=>x.check?.type==='search_results')
  },
  {
    name:'technical_research_is_decomposed_by_dimension',
    objective:'Research current approaches to multi-agent AI coordination, including reliability risks and evaluation methods.',
    check:p=>p.steps.length>=3&&p.steps.every(s=>s.type==='research_search')&&p.steps.some(s=>/benchmarks/.test(s.input.query))&&p.steps.some(s=>/reliability/.test(s.input.query))&&p.acceptanceChecks.some(x=>x.check?.type==='search_results'&&x.check.perStep===true)
  },
  {
    name:'claim_without_sources_stops_before_assessment',
    objective:'Fact-check the claim that the city doubled its public transport budget last year.',
    check:p=>p.steps.length===1&&p.steps[0].type==='research_search'&&p.status==='needs_clarification'&&!p.steps.some(s=>s.type==='assess_claim')
  },
  {
    name:'claim_with_sources_captures_before_assessment',
    objective:'Verify that the city doubled its public transport budget last year using https://city.example.gov/budget and https://audit.example.org/report',
    check:p=>p.steps.length===3&&p.steps[0].type==='retrieve_source'&&p.steps[1].type==='retrieve_source'&&p.steps[2].type==='assess_claim'&&p.steps[2].depends_on.join(',')==='1,2'&&p.acceptanceChecks.some(x=>x.check?.type==='human_review')
  },
  {
    name:'research_plus_task_dependency',
    objective:'Research current battery recycling methods and remind me to review the findings tomorrow.',
    check:p=>p.steps.some(s=>s.type==='research_search')&&p.steps.some(s=>s.type==='create_task'&&s.depends_on.length===1&&s.depends_on[0]===1)
  },
  {
    name:'source_capture_before_knowledge_write',
    objective:'Save this source to my knowledge library: https://docs.example.org/guide',
    check:p=>p.steps.length===2&&p.steps[0].type==='retrieve_source'&&p.steps[1].type==='save_learning'&&p.steps[1].depends_on[0]===1
  },
  {
    name:'unsafe_http_url_not_accepted',
    objective:'Check whether this link is working: http://127.0.0.1/admin',
    check:p=>!p.steps.some(s=>s.type==='verify_url')&&p.status==='needs_clarification'
  },
  {
    name:'consequential_external_action_excluded',
    objective:'Research the best email marketing platforms and then send an email to all customers.',
    check:p=>p.steps.every(s=>s.type==='research_search')&&p.unsupportedRequests.length>0&&!p.steps.some(s=>/email|send/i.test(s.type+' '+s.title))
  },
  {
    name:'ambiguous_objective_requests_clarification',
    objective:'Handle this for me.',
    check:p=>p.status==='needs_clarification'&&p.steps.length===0&&p.clarifyingQuestions.length>0
  },
  {
    name:'claim_source_dependency_graph_valid',
    objective:'Verify the claim "The project launched in 2024 and served 10,000 users." using https://official.example.com/launch and https://independent.example.org/coverage',
    check:p=>validateMissionGraph(p.steps.map((s,i)=>({position:i+1,step_type:s.type,depends_on:s.depends_on}))).valid
  }
];

export function evaluateMissionPlanner() {
  const results=cases.map(c=>{
    try {
      const plan=planMission(c.objective);
      const passed=Boolean(c.check(plan));
      return {name:c.name,ok:passed,detail:passed?'Expected planning and safety invariant passed.':'Planner output did not satisfy the expected invariant.',status:plan.status,stepTypes:plan.steps.map(s=>s.type),stepCount:plan.steps.length};
    } catch(error) {
      return {name:c.name,ok:false,detail:String(error?.message||error).slice(0,180)};
    }
  });
  const passed=results.filter(x=>x.ok).length;
  return {ok:passed===cases.length,fixtureCount:cases.length,passedFixtures:passed,failedFixtures:cases.length-passed,results,detail:passed===cases.length?'Balanced mission-planning fixtures passed across research, claims, dependencies, unsafe inputs, clarification and action boundaries.':'One or more mission-planning fixtures exposed a regression.'};
}
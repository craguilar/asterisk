import {it,expect} from 'vitest';
import {readFile} from 'node:fs/promises';
import {footballContext} from '../src/football.js';
it('returns the exact frozen fitted parameters used to rate the replay fixture',async()=>{
  const saved=JSON.parse(await readFile('data/replay-ratings.json','utf8'));
  const data=await footballContext('2026-11-07T16:00:00.000Z','demo');
  expect(data.matches[0].ratingVersion).toBe(saved.version);
  expect(data.ratings).toMatchObject({version:saved.version,trainedThrough:saved.trainedThrough,rho:saved.rho,advantage:saved.advantage,teams:saved.teams});
  expect(data.source).toContain('OpenFootball');
});

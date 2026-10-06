"use strict";
// Unit test for the view controller: boots a bare `cybersponse` module, loads
// the controller IIFE (which self-registers), then $controller-instantiates it
// with mocked injectables and a mocked $httpBackend. Run with:
//
//   make test-unit WIDGET=ztpGroupTimer        # from the dev-kit root
//   WIDGET=ztpGroupTimer npm test              # in a standalone clone

global.jasmine = global.jasmine || {};

require("angular");
require("angular-mocks");

// The controller reads the pure module off `window`, exactly as the <script>
// tag in view.html provides it in the browser.
window.ztpGroupTimer = require("../widget/widgetAssets/js/ztpGroupTimer.js");

angular.module("cybersponse", []); // eslint-disable-line no-undef
require("../widget/view.controller.js");

const CTRL_NAME = "ztpGroupTimer103DevCtrl";
const ngModule = window.angular.mock.module; // eslint-disable-line no-undef
const ngInject = window.angular.mock.inject; // eslint-disable-line no-undef

function hydra(members) {
  return { "hydra:member": members };
}

/** Boots the controller against a fake /api/query/ztpf_device_automation_steps
 *  that always answers with `opts.steps` (or `[]`), branching by call count
 *  if `opts.stepsSeq` is given -- what a poll picking up a run's PROGRESS
 *  needs, since the second fetch has to answer differently from the first. */
function boot(config, record, opts) {
  opts = opts || {};
  let $scope, $httpBackend, $interval, callCount = 0;
  ngModule("cybersponse", ($provide) => {
    $provide.value("config", config || {});
    $provide.value("FormEntityService", {
      get: () => ({ originalData: record === undefined ? { name: "ztpf-1" } : record }),
    });
  });
  ngInject((_$rootScope_, _$controller_, _$httpBackend_, _$interval_) => {
    $httpBackend = _$httpBackend_;
    $interval = _$interval_;
    $httpBackend.whenPOST(/ztpf_device_automation_steps/).respond(() => {
      const seq = opts.stepsSeq;
      const rows = seq ? (seq[Math.min(callCount, seq.length - 1)]) : (opts.steps || []);
      callCount += 1;
      return [opts.status || 200, hydra(rows)];
    });
    $scope = _$rootScope_.$new();
    _$controller_(CTRL_NAME, { $scope, config: config || {} });
  });
  return { $scope, $httpBackend, $interval };
}

describe("ztpGroupTimer view controller", () => {
  test("no record: loads nothing, shows the no-record state", () => {
    const { $scope } = boot({}, null);
    expect($scope.hasRecord).toBe(false);
    expect($scope.loading).toBe(false);
  });

  test("idle: the run's steps exist but none has started yet", () => {
    const { $scope, $httpBackend } = boot({}, { name: "ztpf-1" }, {
      steps: [{ stepStartTimestamp: null, stepStopTimestamp: null }]
    });
    $httpBackend.flush();
    expect($scope.state).toBe("idle");
    expect($scope.elapsed).toBe(0);
    expect($scope.loading).toBe(false);
  });

  test("running: ticks up once a second while a step is still in flight", () => {
    const { $scope, $httpBackend, $interval } = boot({}, { name: "ztpf-1" }, {
      steps: [{ stepStartTimestamp: 1000, stepStopTimestamp: null }]
    });
    // Freeze Date.now() so the first render is deterministic, then advance it
    // exactly as $interval's own virtual clock advances.
    let now = 1000 * 1000 + 3000; // 3s after the step started
    jest.spyOn(Date, "now").mockImplementation(() => now);
    $httpBackend.flush();
    expect($scope.state).toBe("running");
    expect($scope.elapsed).toBe(3);
    expect($scope.clock).toBe("00:00:03");

    now += 2000;
    $interval.flush(1000);
    $interval.flush(1000);
    expect($scope.elapsed).toBe(5);
    Date.now.mockRestore();
  });

  // Found live on a real box: a step's `status` read "Running" while it
  // already carried a stepStopTimestamp, with a Queued step (no timestamps
  // at all) still behind it -- the widget showed STOPPED at 12m46s with two
  // steps left to run. `stepDone` is fetched and trusted over "has a stop
  // timestamp"; see R.computeWindow's comment.
  test("a Running step with a stray stop timestamp, plus a Queued step behind it, keeps the run RUNNING", () => {
    const { $scope, $httpBackend } = boot({}, { name: "ztpf-1" }, {
      steps: [
        { stepStartTimestamp: 100, stepStopTimestamp: 200, stepDone: false }, // status: Running
        { stepStartTimestamp: null, stepStopTimestamp: null, stepDone: false }, // status: Queued
        { stepStartTimestamp: 50, stepStopTimestamp: 90, stepDone: true }
      ]
    });
    $httpBackend.flush();
    expect($scope.state).toBe("running");
  });

  test("stopped: every step in the group is stepDone -- the clock freezes and polling stops itself", () => {
    const { $scope, $httpBackend, $interval } = boot({ refreshSecs: 1 }, { name: "ztpf-1" }, {
      steps: [{ stepStartTimestamp: 1000, stepStopTimestamp: 1090, stepDone: true }]
    });
    $httpBackend.flush();
    expect($scope.state).toBe("stopped");
    expect($scope.elapsed).toBe(90);

    // A finished run's steps do not change again -- the poll must not keep
    // hitting the server forever.
    $interval.flush(1000);
    $httpBackend.verifyNoOutstandingRequest();
  });

  test("a still-running poll picks up the run finishing on its next tick", () => {
    const { $scope, $httpBackend, $interval } = boot({ refreshSecs: 1 }, { name: "ztpf-1" }, {
      stepsSeq: [
        [{ stepStartTimestamp: 1000, stepStopTimestamp: null, stepDone: false }],
        [{ stepStartTimestamp: 1000, stepStopTimestamp: 1030, stepDone: true }]
      ]
    });
    $httpBackend.flush();
    expect($scope.state).toBe("running");

    $interval.flush(1000);
    $httpBackend.flush();
    expect($scope.state).toBe("stopped");
    expect($scope.elapsed).toBe(30);
  });

  test("a failed fetch surfaces an error and offers a retry", () => {
    const { $scope, $httpBackend } = boot({}, { name: "ztpf-1" }, { status: 500 });
    $httpBackend.flush();
    expect($scope.error).toBeTruthy();
    expect($scope.loading).toBe(false);

    $scope.retry();
    $httpBackend.flush();
  });

  test("$destroy cancels both the tick and the poll -- no leaked intervals", () => {
    const { $scope, $httpBackend, $interval } = boot({ refreshSecs: 1 }, { name: "ztpf-1" }, {
      steps: [{ stepStartTimestamp: 1000, stepStopTimestamp: null }]
    });
    $httpBackend.flush();
    expect($scope.state).toBe("running");
    const renderSpy = jest.spyOn($scope, "_render");
    $scope.$destroy();
    // A cancelled $interval never fires again -- flushing well past both the
    // 1s tick and the 1s poll must produce neither a re-render nor a new
    // request.
    $interval.flush(5000);
    expect(renderSpy).not.toHaveBeenCalled();
    $httpBackend.verifyNoOutstandingRequest();
  });
});

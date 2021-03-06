/**
  * Copyright 2017 Hortonworks.
  *
  * Licensed under the Apache License, Version 2.0 (the "License");
  * you may not use this file except in compliance with the License.
  * You may obtain a copy of the License at
  *   http://www.apache.org/licenses/LICENSE-2.0
  * Unless required by applicable law or agreed to in writing, software
  * distributed under the License is distributed on an "AS IS" BASIS,
  * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
  * See the License for the specific language governing permissions and
  * limitations under the License.
**/

import React, {Component} from 'react';
import PropTypes from 'prop-types';
import ReactDOM from 'react-dom';
import _ from 'lodash';
import {Select2 as Select} from '../../../utils/SelectUtils';
import {Tabs, Tab, OverlayTrigger, Popover} from 'react-bootstrap';
import FSReactToastr from '../../../components/FSReactToastr';
import TopologyREST from '../../../rest/TopologyREST';
import AggregateUdfREST from '../../../rest/AggregateUdfREST';
import Utils from '../../../utils/Utils';
import CommonNotification from '../../../utils/CommonNotification';
import {toastOpt} from '../../../utils/Constants';
import {Scrollbars} from 'react-custom-scrollbars';
import ProcessorUtils  from '../../../utils/ProcessorUtils';
import CommonCodeMirror from '../../../components/CommonCodeMirror';
import WebWorkers  from '../../../utils/WebWorkers';

export default class WindowingAggregateNodeForm extends Component {
  static propTypes = {
    nodeData: PropTypes.object.isRequired,
    editMode: PropTypes.bool.isRequired,
    nodeType: PropTypes.string.isRequired,
    topologyId: PropTypes.string.isRequired,
    versionId: PropTypes.number.isRequired,
    sourceNode: PropTypes.object.isRequired,
    targetNodes: PropTypes.array.isRequired,
    linkShuffleOptions: PropTypes.array.isRequired,
    currentEdges: PropTypes.array.isRequired,
    testRunActivated : PropTypes.bool.isRequired
  };

  constructor(props) {
    super(props);
    this.fetchDataAgain = false;
    this.fieldsArr = [];
    this.streamIdList = [];
    this.tempStreamContextData = {};
    let {editMode} = props;
    var obj = {
      parallelism: 1,
      editMode: editMode,
      selectedKeys: [],
      windowSelectedKeys : [],
      _groupByKeys: [],
      keysList: [],
      intervalType: ".Window$Duration",
      intervalTypeArr: [
        {
          value: ".Window$Duration",
          label: "Time"
        }, {
          value: ".Window$Count",
          label: "Count"
        }
      ],
      windowNum: '',
      slidingNum: '',
      durationType: "Seconds",
      slidingDurationType: "Seconds",
      durationTypeArr: [
        {
          value: "Seconds",
          label: "Seconds"
        }, {
          value: "Minutes",
          label: "Minutes"
        }, {
          value: "Hours",
          label: "Hours"
        }
      ],
      tsField: '',
      lagMs: '',
      outputFieldsArr: [
        {
          conditions : '',
          outputFieldName: '',
          prefetchData : false
        }
      ],
      functionListArr: [],
      outputStreamFields: [],
      argumentError: false,
      showLoading : true,
      scriptErrors : []
    };
    this.state = obj;
    this.workersObj={};
    this.WebWorkers = {};
    this.fetchData();
  }

  /*
    componentWillUpdate has been call very frequently in react ecosystem
    this.context.ParentForm.state has been SET through the API call in ProcessorNodeForm
    And we need to call getDataFromParentFormContext after the Parent has set its state so that inputStreamOptions are available
    to used.
    And this condition save us from calling three API
    1] get edge
    2] get streams
    3] get Node data with config.
  */
  componentWillUpdate() {
    if(this.context.ParentForm.state.inputStreamOptions.length > 0 && !(this.fetchDataAgain)){
      this.getDataFromParentFormContext();
    }
  }

  /*
    fetchData Method is call once on constructor.
    1] getAllUdfs API is call
    And only typeOf "AGGREGATE" are been fetch from the udfList and SET to fieldList

    If this.context.ParentForm.state.inputStreamOptions is present
    we call this.getDataFromParentFormContext Method for further process.
  */
  fetchData(){
    AggregateUdfREST.getAllUdfs().then((udfResult) => {
      if(udfResult.responseMessage !== undefined){
        FSReactToastr.error(
          <CommonNotification flag="error" content={results.responseMessage}/>, '', toastOpt);
      } else {
        //Gather all "AGGREGATE" functions only
        this.udfList = ProcessorUtils.populateFieldsArr(udfResult.entities , "AGGREGATE");
        if(this.context.ParentForm.state.inputStreamOptions.length){
          this.getDataFromParentFormContext();
        }
      }
    });
  }

  /*
    getDataFromParentFormContext is called from two FUNCTION[fetchData,componentWillUpdate]
    Depend upon the condition

    Get the windowsNode from the this.context.ParentForm.state.processorNode
    Get the stream from the this.context.ParentForm.state.inputStreamOptions
    And if windowsNode has the rules Id
    we call this.populateOutputStreamsFromServer with rules ID to pre fill the value on UI
    OR
    we create a dummy ruleNode for the particular windowsNode and update the processor
  */
  getDataFromParentFormContext(){
    let {
      topologyId,
      versionId,
      nodeType,
      nodeData,
      currentEdges,
      targetNodes
    } = this.props;
    this.fetchDataAgain = true;

    // get the ProcessorNode from parentForm Context
    this.windowsNode = this.context.ParentForm.state.processorNode;
    this.configFields = this.windowsNode.config.properties;
    this.windowsRuleId = this.configFields.rules;

    // get the inputStream from parentForm Context
    const inputStreamFromContext = this.context.ParentForm.state.inputStreamOptions;
    let fields = [];
    inputStreamFromContext.map((result, i) => {
      this.streamIdList.push(result.streamId);
      fields.push(...result.fields);
    });
    this.fieldsArr = ProcessorUtils.getSchemaFields(_.unionBy(fields,'name'), 0,false);
    this.fieldsHintArr = _.unionBy(fields,'name');
    let tsFieldOptions =  this.fieldsArr.filter((f)=>{return f.type === 'LONG';});
    // tsFieldOptions should have a default options of processingTime
    tsFieldOptions.push({name: "processingTime", value: "processingTime"});

    let stateObj = {
      parallelism: this.configFields.parallelism || 1,
      keysList: JSON.parse(JSON.stringify(this.fieldsArr)),
      functionListArr: this.udfList,
      tsFieldOptions: tsFieldOptions
    };
    this.populateCodeMirrorDefaultHintOptions();
    if(this.windowsRuleId){
      this.fetchRulesNode(this.windowsRuleId).then((ruleNode) => {
        this.windowRulesNode = ruleNode;
        this.populateOutputStreamsFromServer(this.windowRulesNode);
      });
    } else {
      //Creating window object so output streams can get it
      let dummyWindowObj = {
        name: 'window_auto_generated',
        description: 'window description auto generated',
        projections: [],
        streams: [],
        actions: [],
        groupbykeys: [],
        outputStreams: []
      };
      TopologyREST.createNode(topologyId, versionId, 'windows', {body: JSON.stringify(dummyWindowObj)}).then((windowRuleResult) => {
        this.windowRulesNode = windowRuleResult;
        this.windowsRuleId = windowRuleResult.id;
        this.windowsNode.config.properties.rules = [this.windowsRuleId];
        TopologyREST.updateNode(topologyId, versionId, nodeType, nodeData.nodeId, {
          body: JSON.stringify(this.windowsNode)
        });
        this.setState({showLoading : false});
      });
    }
    this.setState(stateObj, () => {
      this.WebWorkers = new WebWorkers(this.initValidatorWorker());
    });
  }

  populateCodeMirrorDefaultHintOptions(){
    const {udfList} = this;
    this.hintOptions=[];
    // FUNCTION from UDFLIST for hints...
    Array.prototype.push.apply(this.hintOptions,ProcessorUtils.generateCodeMirrorOptions(udfList,"FUNCTION"));
  }

  populateCodeMirrorHintOptions(){
    const {udfList} = this;
    this.hintOptions=[];
    // arguments from field list for hints...
    Array.prototype.push.apply(this.hintOptions,ProcessorUtils.generateCodeMirrorOptions(this.fieldsHintArr,"ARGS"));
    // FUNCTION from UDFLIST for hints...
    Array.prototype.push.apply(this.hintOptions,ProcessorUtils.generateCodeMirrorOptions(udfList,"FUNCTION"));
  }

  /*
    populateOutputStreamsFromServer Method accept the Object send from the getDataFromParentFormContext
    When the window Processor has been already configured
    And we set all the defaultvalue, which we got from there serverWindowObj

    This include Nested fields spliting and populating the pre value for each and every fields on UI
    And SET in state object
  */
  populateOutputStreamsFromServer(serverWindowObj){
    if(serverWindowObj.projections.length > 0){
      const {keysList} = this.state;
      let argsGroupKeys=[];
      const windowProjectionData = this.getScriptConditionAndFieldsForServer(serverWindowObj.projections,keysList);
      const {conditionsArr,fieldKeyArr} = windowProjectionData;
      const {keyArrObj} = ProcessorUtils.normalizationProjectionKeys(fieldKeyArr,keysList);

      const {keys,gKeys} = ProcessorUtils.getKeysAndGroupKey(keyArrObj);
      const keyData = ProcessorUtils.createSelectedKeysHierarchy(keyArrObj,keysList);

      const outputFieldsObj = [];
      _.map(conditionsArr, (cd) => {
        const obj = ProcessorUtils.getReturnTypeFromCodemirror(cd.conditions,this.state.functionListArr,this.fieldsHintArr, this);
        outputFieldsObj.push({
          name : cd.outputFieldName,
          type : obj.returnType
        });
      });

      const tempFields = _.concat(keyData,outputFieldsObj);
      let mainStreamObj = {
        streamId : serverWindowObj.streams[0],
        fields : this.generateOutputFields(tempFields,0)
      };

      // stateObj is define and assign some values
      let stateObj = {
        showLoading:false ,
        outputFieldsArr :conditionsArr,
        outputStreamFields: outputFieldsObj,
        selectedKeys:keys,
        windowSelectedKeys:keyData,
        _groupByKeys : gKeys
      };

      // pre filling serverWindowObj.window values
      if (serverWindowObj.window.windowLength.class === '.Window$Duration') {
        stateObj.intervalType = '.Window$Duration';
        let obj = Utils.millisecondsToNumber(serverWindowObj.window.windowLength.durationMs);
        stateObj.windowNum = obj.number;
        stateObj.durationType = obj.type;
        if (serverWindowObj.window.slidingInterval) {
          let obj = Utils.millisecondsToNumber(serverWindowObj.window.slidingInterval.durationMs);
          stateObj.slidingNum = obj.number;
          stateObj.slidingDurationType = obj.type;
        }
      } else if (serverWindowObj.window.windowLength.class === '.Window$Count') {
        stateObj.intervalType = '.Window$Count';
        stateObj.windowNum = serverWindowObj.window.windowLength.count;
        if (serverWindowObj.window.slidingInterval) {
          stateObj.slidingNum = serverWindowObj.window.slidingInterval.count;
        }
      }
      if(serverWindowObj.window.tsField) {
        stateObj.tsField = serverWindowObj.window.tsField;
        stateObj.lagMs = Utils.millisecondsToNumber(serverWindowObj.window.lagMs).number;
      } else {
        stateObj.tsField = 'processingTime';
      }

      // assign mainStreamObj value to "this.tempStreamContextData" make available for further methods
      this.tempStreamContextData = mainStreamObj;
      this.setState(stateObj);
      this.context.ParentForm.setState({outputStreamObj: mainStreamObj});
    } else {
      this.setState({showLoading:false});
    }
  }

  getScriptConditionAndFieldsForServer = (data,fieldList) => {
    let conditionsArr=[],fieldKeyArr=[];
    _.map(data, (d) => {
      if(d.expr.includes('AS')){
        const obj = d.expr.split('AS');
        conditionsArr.push({
          conditions : obj[0].trim(),
          outputFieldName : obj[1].trim(),
          prefetchData : true
        });
      } else {
        fieldKeyArr.push(d);
      }
    });
    return {conditionsArr,fieldKeyArr};
  }

  /*
    fetchRulesNode Method accept the ruleId
    To get the Rules node through API call
  */
  fetchRulesNode(ruleId){
    const {
      topologyId,
      versionId
    } = this.props;
    return TopologyREST.getNode(topologyId, versionId, 'windows', ruleId);
  }

  /*
    renderFieldOption Method accept the node from the select2
    And modify the Select2 view list with nested look
  */
  renderFieldOption(node) {
    let styleObj = {
      paddingLeft: (10 * node.level) + "px"
    };
    if (node.disabled) {
      styleObj.fontWeight = "bold";
    }
    return (
      <span style={styleObj}>{node.name}</span>
    );
  }

  /*
    validateData check the validation of
     selectedKeys, windowNum, argumentError and outputFieldsArr array
  */
  validateData(){
    let {selectedKeys, windowNum, outputFieldsArr, tsField, lagMs, argumentError,errorString} = this.state;
    let validData = [],promiseArr=[],flag= false, errorText='';
    if(argumentError || windowNum === '' || errorString.length){
      return false;
    }
    if(tsField !== '' && tsField !== 'processingTime' && lagMs === '') {
      validData = false;
    }
    _.map(outputFieldsArr,(field,i) => {
      // push to worker promiseArr
      promiseArr.push(this.WebWorkers.startWorkers(field.conditions.trim()));

      if(!((field.conditions.length == 0 && field.outputFieldName.length == 0) || (field.conditions.length > 0 && field.outputFieldName.length > 0))){
        validData.push(field);
      }
    });

    return Promise.all(promiseArr).then((res) => {
      let arr=[];
      _.map(res, (r) => {
        if(!r.payload.includes('(')){
          r.err = "Only arguments are not allowed!  parent function is mandatory";
        }
        arr.push(r.err);
      });
      if(validData.length === 0 && _.compact(arr).length === 0){
        arr=[];
        flag= true;
      }
      this.setState({scriptErrors : arr});
      return flag;
    });
  }

  /*
    updateProcessorNode Method accept name,description send by handleSave Method
    windowSelectedKeys AND outputStreamFields has been  concat array for outputStreams
    tempOutputFields is the result of the above concat array
    this.generateOutputFields call on tempOutputFields and the result has been added to
    this.windowsNode.outputStreams
    And the windowsNode is updated
  */
  updateProcessorNode(name, description){
    const {outputStreamFields,windowSelectedKeys,parallelism} = this.state;
    const {topologyId, versionId,nodeType,nodeData} = this.props;
    const tempOutputFields = _.concat(windowSelectedKeys,outputStreamFields);
    const streamFields = this.generateOutputFields(tempOutputFields, 0);
    if(this.windowsNode.outputStreams.length > 0){
      this.windowsNode.outputStreams.map((s) => {
        s.fields = streamFields;
      });
    }else{
      _.map(this.outputStreamStringArr , (s) => {
        this.windowsNode.outputStreams.push({
          streamId: s,
          fields: streamFields
        });
      });
    }
    this.windowsNode.config.properties.parallelism = parallelism;
    this.windowsNode.description = description;
    this.windowsNode.name = name;
    return this.windowsNode;
  }

  /*
    updateEdges Method update the edge
    using inputStreamsArr id to filter the currentEdges.streamGrouping.streamId for the particular nodeType
    And update with fields selected as a outputStreams
  */
  updateEdges(){
    const {currentEdges} = this.props;
    const {inputStreamOptions} = this.context.ParentForm.state;

    const fields = this.windowRulesNode.groupbykeys.map((field) => {
      return field.replace(/\[\'/g, ".").replace(/\'\]/g, "");
    });
    const edgeObj = _.filter(currentEdges, (edge) => {
      return edge.streamGrouping.streamId === inputStreamOptions[0].id;
    });
    let edgeData = {
      fromId: edgeObj[0].source.nodeId,
      toId: edgeObj[0].target.nodeId,
      streamGroupings: [
        {
          streamId: edgeObj[0].streamGrouping.streamId,
          grouping: 'FIELDS',
          fields: fields
        }
      ]
    };
    const edgeId = edgeObj[0].edgeId;
    return {edgeId,edgeData};
  }

  /*
    handleSave Method is responsible for windowProcessor
    _groupByKeys is modify with {expr : fields} obj;
    outputFieldsGroupKeys is added to each and every tempArr[index].args
    Rules Node has been updated in this call

    updateProcessorNode Method is a callback
  */
  handleSave(name, description){
    if(this.windowsRuleId){
      let {
        _groupByKeys,
        selectedKeys,
        windowNum,
        slidingNum,
        durationType,
        slidingDurationType,
        intervalType,
        parallelism,
        tsField,
        lagMs,
        outputFieldsArr
      } = this.state;
      let tempArr = [];
      let {topologyId, versionId, nodeType, nodeData} = this.props;

      _.map(outputFieldsArr, (field) => {
        tempArr.push({
          expr : `${field.conditions} AS ${field.outputFieldName}`
        });
      });
      const exprObj = _groupByKeys.map((field) => {return {expr: field};});
      const mergeTempArr = _.concat(tempArr,exprObj);

      this.windowRulesNode.projections = mergeTempArr;
      this.outputStreamStringArr = [
        'window_transform_stream_'+this.windowsNode.id,
        'window_notifier_stream_'+this.windowsNode.id
      ];
      this.windowRulesNode.outputStreams = this.outputStreamStringArr;
      this.windowRulesNode.streams = [this.streamIdList[0]];
      this.windowRulesNode.groupbykeys = _groupByKeys;
      this.windowRulesNode.window = {
        windowLength: {
          class: intervalType
        }
      };

      //Syncing window object into data
      if (intervalType === '.Window$Duration') {
        this.windowRulesNode.window.windowLength.durationMs = Utils.numberToMilliseconds(windowNum, durationType);
        if (slidingNum !== '') {
          this.windowRulesNode.window.slidingInterval = {
            class: intervalType,
            durationMs: Utils.numberToMilliseconds(slidingNum, slidingDurationType)
          };
        }
      } else if (intervalType === '.Window$Count') {
        this.windowRulesNode.window.windowLength.count = windowNum;
        if (slidingNum !== '') {
          this.windowRulesNode.window.slidingInterval = {
            class: intervalType,
            count: slidingNum
          };
        }
      }
      if(tsField !== '' && tsField !== 'processingTime'){
        this.windowRulesNode.window.tsField = tsField;
        this.windowRulesNode.window.lagMs = Utils.numberToMilliseconds(lagMs, 'Seconds');
      }
      let promiseArr = [];
      const windowsNodeObj = this.updateProcessorNode(name, description);
      promiseArr.push(TopologyREST.updateNode(topologyId, versionId, nodeType, windowsNodeObj.id, {body: JSON.stringify(windowsNodeObj)}));

      promiseArr.push(TopologyREST.updateNode(topologyId, versionId, 'windows', this.windowsRuleId, {body: JSON.stringify(this.windowRulesNode)}));

      const {edgeId , edgeData} = this.updateEdges();
      promiseArr.push(TopologyREST.updateNode(topologyId, versionId, 'edges', edgeId, {body: JSON.stringify(edgeData)}));

      return  Promise.all(promiseArr);
    }
  }

  /*
    generateOutputFields Method accept the array of object and level[NUMBER] for NESTED fields
    And it modify the fields into new Object with returnType
  */
  generateOutputFields(fields, level) {
    const {keysList} = this.state;
    return fields.map((field) => {
      let obj = {
        name: field.name || field.outputFieldName ,
        type: field.type || this.getReturnType(field.functionName, ProcessorUtils.getKeyList(field.args,keysList)),
        optional : field.optional || false
      };

      if (field.type === 'NESTED' && field.fields) {
        obj.fields = this.generateOutputFields(field.fields, level + 1);
      }
      return obj;
    });
  }

  /*
    handleKeysChange Method accept arr of obj
    And SET
    selectedKeys : key of arr used on UI for listing
    _groupByKeys : group the selectedKeys
    windowSelectedKeys : store the obj of the selectedKeys
  */
  handleKeysChange(arr){
    let {keysList,outputStreamFields,windowSelectedKeys} = this.state;
    const keyData = ProcessorUtils.createSelectedKeysHierarchy(arr,keysList);
    this.tempStreamContextData.fields = outputStreamFields.length > 0  ? _.concat(keyData , outputStreamFields) : keyData;

    const {keys,gKeys} = ProcessorUtils.getKeysAndGroupKey(arr);
    this.setState({selectedKeys: keys, _groupByKeys: gKeys, windowSelectedKeys: keyData});
    this.context.ParentForm.setState({outputStreamObj: this.tempStreamContextData});
  }

  /*
    handleSelectAllOutputFields method select all keys
  */
  handleSelectAllOutputFields = () => {
    const arr = ProcessorUtils.selectAllOutputFields(this.state.keysList);
    this.handleKeysChange(arr);
  }

  /*
    commonHandlerChange Method accept keyType, obj and it handles multiple event [durationType,slidingDurationType,intervalType]
    params@ keyType = string 'durationType'
    params@ obj = selected obj
  */
  commonHandlerChange(keyType,obj){
    if(obj){
      const keyName = keyType.trim();
      keyName === "durationType"
      ? this.setState({durationType : obj.value,slidingDurationType: obj.value})
      : keyName === "slidingDurationType"
        ? this.setState({slidingDurationType : obj.value})
        : this.setState({intervalType : obj.value});
    }
  }

  /*
    handleTimestampFieldChange method handles change of timestamp field
    params@ obj selected option
  */
  handleTimestampFieldChange(obj) {
    if(obj){
      this.setState({tsField: obj.name});
    } else {
      this.setState({tsField: '', lagMs: ''});
    }
  }


  /*
    getReturnType Method accept the params
    Param@ functionName
    Param@ fieldObj
    Param@ index

    And it check the returnType is support in the argument array of the fieldObj
    if argList is empty then it return fieldObj.type and  show Error on UI
    else 'DOUBLE' as default;
  */
  getReturnType(functionName, fieldObj, index) {
    let obj = this.state.functionListArr.find((o) => {
      return o.name === functionName;
    });
    if (obj) {
      if (obj.argTypes && fieldObj) {
        return obj.returnType || fieldObj.type;
      }
    } else if (fieldObj) {
      return fieldObj.type;
    } else {
      return 'DOUBLE';
    }
  }

  /*
    getFunctionDisplayName Method accept the functionName
    And get the displayName from the functionListArr
  */
  getFunctionDisplayName(functionName){
    if(functionName === ""){
      return "";
    }
    const {functionListArr} = this.state;
    let obj = functionListArr.find((o) => {
      return o.name === functionName;
    });
    return obj.displayName;
  }

  /*
    This Mehods call from [handleOutputFieldName,handleFieldChange] FUNCTIONS
    setParentContextOutputStream Mehod accept index and outputFlag
    outputFlag = true then it will assign the value SET by handleOutputFieldName Function

    update the local state and parentContext also;
    And Two array is concat to make the outputStreamObj of parentContext
  */
  setParentContextOutputStream(index,outputFlag){
    let funcReturnType = "",obj={},error='';
    const {outputFieldsArr,windowSelectedKeys,functionListArr,keysList} = this.state;
    let mainObj = _.cloneDeep(this.state.outputStreamFields);
    if(!!outputFieldsArr[index].conditions){
      const val = outputFieldsArr[index].conditions;
      obj = ProcessorUtils.getReturnTypeFromCodemirror(val.trim(),functionListArr,this.fieldsHintArr, this);
      funcReturnType = obj.returnType;
    }
    mainObj[index] = {
      name: (outputFieldsArr[index].outputFieldName !== undefined && outputFieldsArr[index].outputFieldName !== "") ? outputFieldsArr[index].outputFieldName : "",
      type:  funcReturnType ? funcReturnType : ""
    };
    // b_Index is used to restrict the empty fields in streamObj.
    const b_Index = _.findIndex(outputFieldsArr, (field) => { return field.conditions === '' && field.outputFieldName === '';});
    if(b_Index !== -1){
      mainObj.splice(b_Index,1);
    }

    // create this.tempStreamContextData obj to save in ParentForm context
    const tempStreamData = _.concat(windowSelectedKeys,mainObj);
    this.tempStreamContextData = {fields : tempStreamData  , streamId : this.streamIdList[0]};
    this.setState({outputStreamFields : mainObj, argumentError : !!obj.error ? true : false, errorString : !!obj.error ? obj.error : ''});
    this.context.ParentForm.setState({outputStreamObj: this.tempStreamContextData});
  }

  /*
    handleValueChange Method is handles to fields on UI
    windowNum and slidingNum input value
  */
  handleValueChange(e){
    let obj = {};
    let name = e.target.name;
    let value = e.target.type === "number"
      ? Math.abs(e.target.value)
      : e.target.value;
    obj[name] = value;
    if (name === 'windowNum') {
      obj['slidingNum'] = value;
    }
    this.setState(obj);
  }

  /*
    addOutputFields Method add the row on UI with blank text
  */
  addOutputFields(){
    if (this.state.editMode) {
      const el = document.querySelector('.processor-modal-form ');
      const targetHt = el.scrollHeight;
      Utils.scrollMe(el, (targetHt + 100), 2000);

      let fieldsArr = this.state.outputFieldsArr;
      fieldsArr.push({conditions: '', outputFieldName: '',prefetchData: false});
      this.setState({outputFieldsArr: fieldsArr});
    }
  }

  /*
    deleteFieldRow Method accept the index
    And delete to fields from the two Array [outputFieldsArr , outputStreamFields]
  */
  deleteFieldRow(index){
    const {windowSelectedKeys} = this.state;
    let fieldsArr = _.cloneDeep(this.state.outputFieldsArr);
    let mainOutputFields = _.cloneDeep(this.state.outputStreamFields);

    fieldsArr.splice(index,1);
    mainOutputFields.splice(index,1);

    const tempStreamData = _.concat(windowSelectedKeys,mainOutputFields);
    this.tempStreamContextData.fields = tempStreamData;
    _.map(fieldsArr, (f,i) => {
      f.prefetchData = true;
      this.refs["codeRef-"+i].codeWrapper.setValue(f.conditions);
    });
    this.setState({outputFieldsArr : fieldsArr,outputStreamFields : mainOutputFields});
    this.context.ParentForm.setState({outputStreamObj: this.tempStreamContextData});
  }

  initValidatorWorker = () => {
    const {fieldsHintArr,state} = this;
    const {functionListArr} = state;
    return ProcessorUtils.webWorkerValidator(fieldsHintArr, functionListArr);
  }

  handleScriptChange = (index, val) => {
    let tempArr = _.cloneDeep(this.state.outputFieldsArr);
    let showErr = false;
    if(val === ""){
      showErr = true;
    }
    tempArr[index].conditions = val;
    this.setState({invalidInput : showErr,outputFieldsArr : tempArr}, () => {
      this.setParentContextOutputStream(index);
    });
  }

  handleFieldNameChange(index,event){
    let tempArr = _.cloneDeep(this.state.outputFieldsArr);
    let showErr = false;
    if(event.target.value === ""){
      showErr = true;
    }
    tempArr[index].outputFieldName = event.target.value;
    this.setState({invalidInput : showErr,outputFieldsArr : tempArr}, () => {
      this.setParentContextOutputStream(index);
    });
  }

  render(){
    const {
      editMode,
      showLoading,
      keysList,
      selectedKeys,
      intervalType,
      intervalTypeArr,
      durationType,
      durationTypeArr,
      windowNum,
      slidingNum,
      tsField,
      tsFieldOptions,
      lagMs,
      slidingDurationType,
      argumentError,
      outputFieldsArr,
      functionListArr,
      scriptErrors,
      errorString
    } = this.state;
    const disabledFields = this.props.testRunActivated ? true : !editMode;
    return(
      <div className="modal-form processor-modal-form">
        <Scrollbars autoHide renderThumbHorizontal={props => <div {...props} style={{
          display: "none"
        }}/>}>
            {
              showLoading
              ? <div className="loading-img text-center">
                  <img src="styles/img/start-loader.gif" alt="loading" style={{
                    marginTop: "140px"
                  }}/>
                </div>
              : <form className="customFormClass">
                <div className="form-group">
                  <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Group by keys</Popover>}>
                    <label>Select Keys</label>
                  </OverlayTrigger>
                  <label className="pull-right">
                    <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Select All Keys</Popover>}>
                      <a href="javascript:void(0)" onClick={this.handleSelectAllOutputFields}>Select All</a>
                    </OverlayTrigger>
                  </label>
                  <div>
                    <Select value={selectedKeys} options={keysList} onChange={this.handleKeysChange.bind(this)} multi={true} disabled={disabledFields} valueKey="name" labelKey="name" optionRenderer={this.renderFieldOption}/>
                  </div>
                </div>
                <div className="form-group">
                  <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Window interval type</Popover>}>
                <label>Window Interval Type
                  <span className="text-danger">*</span>
                </label>
                  </OverlayTrigger>
                  <div>
                    <Select value={intervalType} options={intervalTypeArr} onChange={this.commonHandlerChange.bind(this,'intervalType')} required={true} disabled={disabledFields} clearable={false}/>
                  </div>
                </div>
                <div className="form-group">
                  <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Window interval duration</Popover>}>
                    <label>Window Interval
                      <span className="text-danger">*</span>
                    </label>
                  </OverlayTrigger>
                  <div className="row">
                    <div className="col-sm-5">
                      <input name="windowNum" value={windowNum} onChange={this.handleValueChange.bind(this)} type="number" className="form-control" required={true} disabled={disabledFields} min="0" inputMode="numeric"/>
                    </div>
                    {intervalType === '.Window$Duration'
                      ? <div className="col-sm-5">
                          <Select value={durationType} options={durationTypeArr} onChange={this.commonHandlerChange.bind(this,'durationType')} required={true} disabled={disabledFields} clearable={false}/>
                        </div>
                      : null}
                  </div>
                </div>
                <div className="form-group">
                  <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Sliding interval duration</Popover>}>
                    <label>Sliding Interval</label>
                  </OverlayTrigger>
                  <div className="row">
                    <div className="col-sm-5">
                      <input name="slidingNum" value={slidingNum} onChange={this.handleValueChange.bind(this)} type="number" className="form-control" required={true} disabled={disabledFields} min="0" inputMode="numeric"/>
                    </div>
                    {intervalType === '.Window$Duration'
                      ? <div className="col-sm-5">
                          <Select value={slidingDurationType} options={durationTypeArr} onChange={this.commonHandlerChange.bind(this,'slidingDurationType')} required={true} disabled={disabledFields} clearable={false}/>
                        </div>
                      : null}
                  </div>
                </div>
                <div className="form-group">
                  <div className="row">
                    <div className="col-sm-5">
                      <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Timestamp field name</Popover>}>
                        <label>Timestamp Field</label>
                      </OverlayTrigger>
                    </div>
                    {tsField !== '' && tsField !== 'processingTime' ?
                    <div className="col-sm-5">
                      <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Lag duration</Popover>}>
                        <label>Lag in Seconds<span className="text-danger">*</span></label>
                      </OverlayTrigger>
                    </div>
                    : ''}
                  </div>
                  <div className="row">
                    <div className="col-sm-5">
                      <Select value={tsField} options={tsFieldOptions} onChange={this.handleTimestampFieldChange.bind(this)} disabled={disabledFields} valueKey="name" labelKey="name" />
                    </div>
                    {tsField !== '' && tsField !== 'processingTime' ?
                    <div className="col-sm-5">
                      <input name="lagMs" value={lagMs} onChange={this.handleValueChange.bind(this)} type="number" className="form-control" required={true} disabled={disabledFields} min="0" inputMode="numeric"/>
                    </div>
                    : ''}
                  </div>
                </div>
                {
                    argumentError
                      ? <label className="color-error"> {errorString} </label>
                      :''
                  }
                  <div className="row">
                    <div className="col-sm-7 outputCaption">
                      <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Projection Conditions</Popover>}>
                      <label>AGGREGATE Expression</label>
                      </OverlayTrigger>
                    </div>
                    <div className="col-sm-3 outputCaption">
                      <OverlayTrigger trigger={['hover']} placement="right" overlay={<Popover id="popover-trigger-hover">Output field name</Popover>}>
                      <label>Fields Name</label>
                      </OverlayTrigger>
                      <OverlayTrigger trigger={['hover']} placement="left" overlay={<Popover id="popover-trigger-hover">Type @ to see all the available options</Popover>}>
                        <i className="fa fa-info-circle pull-right" style={{backgroundColor : "#ffffff" ,color: '#1892c1'}}></i>
                      </OverlayTrigger>
                    </div>
                  </div>

                  {outputFieldsArr.map((obj, i) => {
                    const functionClass = ['projection-codemirror'];
                    const argumentsClass = [];
                    const nameClass = ['form-control'];

                    if(obj.conditions.length == 0 && obj.outputFieldName.length > 0){
                      functionClass.push('invalid-codemirror');
                    }
                    if(obj.outputFieldName.length == 0 && obj.conditions.length > 0){
                      nameClass.push('invalidInput');
                    }

                    return (
                      <div key={i} className="row form-group">
                        {
                          scriptErrors[i]
                          ? <div><label  className="color-error" style={{fontSize:10}}>{scriptErrors[i]}</label></div>
                          : null
                        }
                        <div className="col-sm-7">
                          <div className={functionClass.join(' ')}>
                            <CommonCodeMirror ref={"codeRef-"+i} editMode={obj.prefetchData} modeType="javascript" hintOptions={this.hintOptions} value={obj.conditions} placeHolder="Expression goes here..." callBack={this.handleScriptChange.bind(this,i)} />
                          </div>
                        </div>
                        <div className="col-sm-3">
                          <input name="outputFieldName" className={nameClass.join(' ')} value={obj.outputFieldName} ref="outputFieldName" onChange={this.handleFieldNameChange.bind(this, i)} type="text" required={true} disabled={disabledFields}/>
                        </div>
                        {editMode
                          ? <div className="col-sm-2">
                              <button className="btn btn-default btn-sm" type="button" disabled={disabledFields} onClick={this.addOutputFields.bind(this)}>
                                <i className="fa fa-plus"></i>
                              </button>&nbsp; {i > 0
                                ? <button className="btn btn-sm btn-danger" type="button" onClick={this.deleteFieldRow.bind(this, i)}>
                                    <i className="fa fa-trash"></i>
                                  </button>
                                : null}
                            </div>
                          : null}
                      </div>
                    );
                  })}
              </form>
            }
        </Scrollbars>
      </div>
    );
  }
}

WindowingAggregateNodeForm.contextTypes = {
  ParentForm: PropTypes.object
};

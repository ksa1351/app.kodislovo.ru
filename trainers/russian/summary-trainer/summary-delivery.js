(function(root){
  'use strict';
  function validReceipt(receipt,payload) {
    return receipt?.schemaVersion==='kodislovo.summary-receipt.v1' && receipt.status==='accepted' && receipt.journal==='teacher' &&
      receipt.sourceSubmissionId===payload.submission_id && receipt.revision===payload.revision && typeof receipt.submissionId==='string' && receipt.submissionId.length>0;
  }
  async function send(url,payload,fetcher=fetch) {
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),45000);
    try {
      const response=await fetcher(url,{method:'POST',credentials:'omit',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload),signal:controller.signal});
      let data;try {data=await response.json();}catch(_){throw Error('Кабинет не подтвердил сохранение. Повторите отправку.');}
      if(!response.ok) {
        const error=Error(data.error?.message || (typeof data.detail==='string'?data.detail:'Не удалось отправить работу. Повторите отправку.'));
        error.safeToEdit=response.status===400 || response.status===422;throw error;
      }
      if(!validReceipt(data,payload))throw Error('Кабинет не подтвердил сохранение. Повторите отправку.');
      return data;
    }catch(error){
      if(error.name==='AbortError' || error instanceof TypeError)throw Error('Подтверждение не получено. Черновик сохранён на устройстве; повторите отправку.');
      throw error;
    }finally{clearTimeout(timer);}
  }
  root.SummaryDelivery={validReceipt,send};
  if(typeof module!=='undefined')module.exports=root.SummaryDelivery;
})(globalThis);

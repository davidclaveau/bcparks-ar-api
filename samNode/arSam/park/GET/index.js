const { runQuery, TABLE_NAME, sendResponse, logger  } = require("/opt/baseLayer");
const {roleFilter} = require("/opt/permissionLayer");

exports.handler = async (event, context) => {
  logger.info("GET: Park");

  // Allow CORS
  if (event.httpMethod === 'OPTIONS') {
    return sendResponse(200, {}, 'Success', null, context);
  }

  let queryObj = {
    TableName: TABLE_NAME,
  };

  try {

    const permissionObject = event.requestContext.authorizer;
    permissionObject.role = JSON.parse(permissionObject.role);

    if (!event.queryStringParameters) {
      // Get me a list of parks, with subareas
      queryObj.ExpressionAttributeValues = {};
      queryObj.ExpressionAttributeValues[":pk"] = { S: "park" };
      queryObj.KeyConditionExpression = "pk =:pk";
      let results = [];
      let parkData;
      do {
        parkData = await runQuery(queryObj, true);
        parkData.data.forEach((item) => results.push(item));
        queryObj.ExclusiveStartKey = parkData.LastEvaluatedKey;
      } while (typeof parkData.LastEvaluatedKey !== "undefined");

      if (permissionObject.isAdmin) {
        // Sysadmin, they get it all
        logger.info("**Sysadmin**");
      } else {
        // Some other authenticated role
        logger.info(
          "**Some other authenticated person with attendance-and-revenue roles**"
        );
        logger.debug("permissionObject.roles:", permissionObject.role);
        // We're getting parks, so take their role and grab the orcs id from the front
        const parkRoles = permissionObject.role.map((item) => {
          return item.split(":")[0];
        });
        logger.debug("Effective park roles:", parkRoles);
        results = await roleFilter(results, parkRoles);
        results = await filterSubAreaAccess(permissionObject, results);
        logger.debug(results);
      }
      logger.debug("RES:", results);
      return sendResponse(200, results, context);
    } else if (event.queryStringParameters?.orcs) {
      // Get me a list of this parks' subareas with activities details, including config details
      queryObj.ExpressionAttributeValues = {};
      queryObj.ExpressionAttributeValues[":pk"] = {
        S: "park::" + event.queryStringParameters?.orcs,
      };
      queryObj.KeyConditionExpression = "pk =:pk";

      if (event?.queryStringParameters?.subAreaId) {
        // get specific subarea by subAreaId
        queryObj.ExpressionAttributeValues[":sk"] = {
          S: `${event.queryStringParameters?.subAreaId}`,
        };
        queryObj.KeyConditionExpression += " AND sk =:sk";
      }

      let results = [];
      let parkData;
      do {
        parkData = await runQuery(queryObj, true);
        parkData.data.forEach((item) => {
          item.activities = Array.from(item.activities);
          results.push(item)
        });
        queryObj.ExclusiveStartKey = parkData.LastEvaluatedKey;
      } while (typeof parkData.LastEvaluatedKey !== "undefined");

      if (permissionObject.isAdmin) {
        // Sysadmin, they get it all
        logger.info("**Sysadmin**");
      } else {
        // Some other authenticated role
        logger.info(
          "**Some other authenticated person with attendance-and-revenue role**"
        );
        logger.debug("permissionObject.role:", permissionObject.role);
        results = await roleFilter(results, permissionObject.role);
        logger.debug(JSON.stringify(results));
      }

      return sendResponse(200, results, context);
    } else {
      throw "Invalid parameters for call.";
    }
  } catch (err) {
    logger.error(err);
    return sendResponse(400, err, context);
  }
};

async function filterSubAreaAccess(permissionObject, parks) {
  logger.debug("filterSubAreaAccess:", permissionObject, parks);

  let newParks = [];
  for (let park of parks) {
    let parkSubAreaAccess = [];
    let results = [];
    logger.info("filterSubAreaAccess:", park.orcs);
    let queryObj = {
      TableName: TABLE_NAME,
    };
    queryObj.ExpressionAttributeValues = {};
    queryObj.ExpressionAttributeValues[":pk"] = { S: `park::${park.orcs}` };
    queryObj.KeyConditionExpression = "pk =:pk";

    let parkData;

    do {
      parkData = await runQuery(queryObj, true);
      parkData.data.forEach((item) => results.push(item));
      queryObj.ExclusiveStartKey = parkData.LastEvaluatedKey;
    } while (typeof parkData.LastEvaluatedKey !== "undefined");

    results = await roleFilter(results, permissionObject.role);
    results.forEach((item) => {
      parkSubAreaAccess.push({ name: item.subAreaName, id: item.sk });
    });
    park.subAreas = parkSubAreaAccess;
    newParks.push(park);
  }

  logger.debug("newParks:", newParks);
  return newParks;
}

const {
    dynamodb,
    incrementAndGetNextSubAreaID,
    getOne,
    logger,
    sendResponse
  } = require("/opt/baseLayer");
  const { createKeycloakRole } = require("/opt/keycloakLayer");
  const { createPutFormulaConfigObj } = require("/opt/formulaLayer");
  const { decodeJWT, resolvePermissions } = require("/opt/permissionLayer");
  const {
    getValidSubareaObj,
    createUpdateParkWithNewSubAreaObj,
    createPutSubAreaObj,
  } = require("/opt/subAreaLayer");
  
  const SSO_ORIGIN = process.env.SSO_ORIGIN;
  const SSO_CLIENT_ID = process.env.SSO_CLIENT_ID;
  
  exports.handler = async (event, context) => {
    logger.debug("Subarea POST:", event);
    try {
      const token = await decodeJWT(event);
      const permissionObject = resolvePermissions(token);
  
      if (!permissionObject.isAuthenticated) {
        logger.info("**NOT AUTHENTICATED, PUBLIC**");
        return sendResponse(403, { msg: "Unauthenticated." }, context);
      }
  
      // Admins only
      if (!permissionObject.isAdmin) {
        logger.info("Not authorized.");
        return sendResponse(403, { msg: "Unauthorized." }, context);
      }
  
      const body = JSON.parse(event.body);
  
      // ensure all madatory fields exist
      if (
        !body.orcs ||
        !body.activities ||
        !body.managementArea ||
        !body.section ||
        !body.region ||
        !body.bundle ||
        !body.subAreaName
      ) {
        return sendResponse(400, { msg: "Invalid body" }, context);
      }
  
      // Get park
      console.log("GET ONE PARK")
      const park = await getOne("park", body.orcs);
      if (!park) {
        logger.debug("Unable to find park", body.orcs);
        return sendResponse(400, { msg: "Park not found" }, context);
      }
  
      // Create post obj
      console.log("getvalidSubareaobj")
      let subAreaObj = getValidSubareaObj(body, park.parkName);
  
      // Generate subArea id
      console.log("incrementandgetnextsubareaidTime")
      const subAreaId = await incrementAndGetNextSubAreaID();
  
      // Create transaction
      let transactionObj = { TransactItems: [] };
  
      // Update park
      console.log("Updating park")
      transactionObj.TransactItems.push({
        Update: createUpdateParkWithNewSubAreaObj(
          subAreaObj.subAreaName,
          subAreaId,
          subAreaObj.isLegacy,
          subAreaObj.orcs
        ),
      });
  
      // Create subArea
      console.log("Creating subarea")
      transactionObj.TransactItems.push({
        Put: createPutSubAreaObj(subAreaObj, subAreaId, park.parkName),
      });
  
      // Create formula configs
      for (const formulaObj of createPutFormulaConfigObj(
        subAreaObj.activities,
        subAreaId,
        park.parkName,
        subAreaObj.orcs,
        subAreaObj.subAreaName
      )) {
        transactionObj.TransactItems.push({
          Put: formulaObj,
        });
      }
       console.log("AT dynamodb transact")
       console.log(dynamodb)
      const res = await dynamodb.transactWriteItems(transactionObj).promise();
      logger.debug("res:", res);
  
      // Add Keycloak role
      const kcRes = await createKeycloakRole(
        SSO_ORIGIN,
        SSO_CLIENT_ID,
        event.headers.Authorization.replace("Bearer ", ""),
        `${subAreaObj.orcs}:${subAreaId}`,
        `${park.parkName}:${subAreaObj.subAreaName}`
      );
      logger.debug("kcRes:", kcRes);
  
      return sendResponse(200, { msg: "Subarea created", subArea: res }, context);
    } catch (err) {
      logger.error(err);
      return sendResponse(400, { msg: "Invalid request" }, context);
    }
  };
  